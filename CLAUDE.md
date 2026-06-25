# CLAUDE.md — how we work on Dynamique-Chimie

Real-time, scientifically-grounded **molecular-dynamics** simulator (oil/water demixing, states of
matter, surface tension, dissolution…) in real physical units. Stack: **Three.js (WebGPU/TSL),
React, TypeScript (strict), Bun, Vite, Vitest, Playwright, Zustand, Zod**.

This file documents the **working method** we've settled into. Read it first; it will make you
productive immediately and keep the project consistent.

---

## 1. The working loop (do this every change)

1. **Implement** a small, coherent slice.
2. `bun run lint:fix` — Biome formats/fixes (see §5; the harness formatter fights Biome, so always
   run this before reading errors or committing).
3. `bun run typecheck` — strict TS must be clean.
4. `bun run test` — unit/golden tests green.
5. **Verify it visually** when the change is rendering- or GPU-related — see §4. This is not
   optional: most real bugs this project has hit were invisible to the unit tests and only showed
   up on screen.
6. `bun run build` then run the e2e (`bun run preview` + `playwright test`).
7. **Commit** at the end of each phase, with the trailers in §7, and **update `tracking.md`**.

`bun run check` runs lint + typecheck + test in one go.

### Phase discipline (the standing convention)
Work in **phases**. At the end of each phase: **commit**, and maintain **`tracking.md`** with the
state of every phase **and any deviations from the plan** (`docs/PLAN.md`, `docs/PLAN-v2.md`).
Never let `tracking.md` go stale — it's the project's running log and the place deviations are
justified. Favor "best code & work practice": full testing everywhere, small verified steps.

---

## 2. Architecture (one-way dependency flow)

```
core/    pure physics, Float64, fully unit-tested — the source of truth
  ↳ forces/ (none, wca, lennardJones, lennardJonesCell, ionic, water, molecular)
  ↳ integrators/ (velocityVerlet), constraints (SHAKE/RATTLE), neighbors (cell-list O(N)),
    boundary, box, init, rng (seeded mulberry32), species, units, observables, water,
    mixture (oil/water), dissolution (salt/water)
engine/  cpu/CpuEngine (the deterministic ORACLE) + gpu/GpuEngine (WebGPU/TSL perf path)
render/  drivers (CPU/GPU), SimulationView, ParticleSystem, BondSystem, GpuParticleSystem,
         FluidRenderer (screen-space metaballs)
state/   Zustand vanilla store + Zod schema + snapshots
scenes/  registry of ready-made presets (full reproducible SimConfig each)
ui/      React control panel, graphs, scene picker (imperative bridge to SimulationView)
```

Rules: `core/` imports nothing above it. The **CPU engine is the validated reference**; the GPU
engine is the performance path and must match it. Physics changes go in `core/` with a test first.

### The accuracy ladder (`level` in SimConfig)
Each level switches on one more interaction. This is the project's backbone:
`L0` ideal gas · `L1` WCA soft spheres · `L2` Lennard-Jones · `L3` + Coulomb (Wolf DSF) ions ·
`L4` atomistic water (SPC/Fw, flexible) · `L5` rigid water (SHAKE) · `L6` oil/water mixture
(hydrophobic demixing) · `L7` water droplet (surface tension) · `L8` salt dissolution ·
`L9` alkane chains (RB **dihedrals** ⇒ trans/gauche conformations) · `L10` **Morse** dissociation
(anharmonic bonds break when heated).
Adding a level = add to `ACCURACY_LEVELS`, the Zod enum, `makeForceModel`/`configure` in CpuEngine,
`setLevel`, and a scene.

### Forces & ensembles beyond the ladder
- **External fields** (in the integrator kick, CPU + GPU): gravity (−y accel) and a uniform
  **electric field** `F = q·E` (+x, charge-dependent) — drives the "Électrophorèse" demo.
- **Bonded** (`forces/molecular.ts`, CPU): harmonic/**Morse** bonds, harmonic angles, **RB
  dihedrals** — each verified against the numerical energy gradient (`dihedralMorse.test.ts`).
- **Thermostats** (`core/thermostats`): `none`/`berendsen`/`csvr`/**`langevin`**. Langevin =
  per-atom friction + random kick (Brownian motion + true NVT). On the GPU the random kick uses an
  explicit integer **PCG hash** of (atom, step, component) — a real per-element RNG; the built-in
  TSL `hash` is smooth value-noise and gives coherent (wrong) kicks, so don't use it here.

---

## 3. Physics conventions (keep it "perfectly accurate")

- **Units = GROMACS internal**: nm, ps, u (amu), kJ·mol⁻¹, K, e. In these units KE = ½·m·v² and
  a = F/m need **no** conversion factor. Constants live in `core/units.ts`.
- **Velocity-Verlet** (symplectic). Gravity is a uniform −y acceleration added in the kick.
- **Forces** use minimum-image PBC; molecular forces use per-atom `moleculeId` for intramolecular
  exclusions. LJ uses **shifted-force** truncation at 2.5σ (continuous force at the cutoff);
  electrostatics use **Wolf DSF** (O(N), no FFT) with an `erfc` approximation.
- **Determinism**: seeded RNG (`Rng`), reproducible per-thread summation; snapshots round-trip
  through Zod.
- New molecular systems are built by dedicated builders (`water.ts`, `mixture.ts`, `dissolution.ts`)
  that return state + species + topology (bonds/angles/constraints) + render bonds.

---

## 4. Visual & GPU verification — THE key technique

Headless WebGPU here **does not composite the canvas into screenshots** and **never resolves
`mapAsync` readback**. So:

- **To actually see the simulation, drive a HEADED browser** and screenshot it:
  ```js
  import { chromium } from "@playwright/test";
  const b = await chromium.launch({ headless: false, args: ["--enable-unsafe-webgpu"] });
  // page.goto preview URL → getByRole('button',{name:/…/}).click() → screenshot()
  // read live metrics: page.locator('[data-testid^="metric-"]').allTextContents()
  // reach the GPU engine for debug: page.evaluate(() => window.__gpu?.…)  (add the hook temporarily)
  ```
  Put the script under the repo (so it resolves `@playwright/test`), output PNGs to the scratchpad,
  then **Read the PNGs** to inspect. This is how we found: the "black screen" (a headless artifact,
  not a bug), the NaCl explosion, the wrong-physics GPU, the missing molecular bonds, etc.
- **Numerical GPU correctness** (vs the CPU oracle) and **fluid/visual appearance** can ONLY be
  validated in a **real browser**. CI/e2e validates the cheaper invariants: shaders compile,
  kernels dispatch, the step counter advances, and there are **zero page errors**.
- Quick GPU sanity = read the temperature metric headed: a physical T (~target) means it works; a
  number like `1e40 K` means the kernel is broken.

GPU support today (the rule: **the GPU runs only what it reproduces identically to the CPU oracle**):
**monatomic L0–L3** (multi-species LJ + Coulomb), periodic or reflective, no barostat. There it is
verified to match the CPU — lj-liquid 90 K, NaCl ~300 K, crystallise 35 K all track the CPU — and the
**O(N) sorted-particle cell list** (counting sort: clear → count → exclusive prefix-sum → scatter
into a sorted array → 27-cell traversal with a dynamic per-cell loop — no fixed capacity, so no
phantom pairs) scales it to **~16k atoms @ ~87 FPS**. `gpuSupportsConfig()` returns
`monatomic && barostat==="none"`.

**Molecular levels (L4–L8) are CPU-only.** The GPU molecular kernels exist and are *correct* — their
forces (LJ + Wolf-DSF Coulomb + bonds/angles via an **i32 quantised force accumulator** since WebGPU
has no f32 atomics + intramolecular `moleculeId` exclusions + per-molecule SHAKE/RATTLE) match the
CPU to **float32 precision** (verified force-by-force at identical positions). BUT the float32
velocity-Verlet doesn't conserve energy like the CPU's float64 for these stiff, light-atom (H),
strong-Coulomb systems: under NVE GPU water runs ~2000 K vs the CPU's ~550 K (dt-independent, not a
forces bug), so water never coheres into a droplet. Until a mixed-precision integrator lands,
molecular runs on the CPU where it's correct — so **every GPU compute matches the CPU**. The shared
deterministic **`engine/buildSystem.ts`** (lock-step tested) still backs both engines.

---

## 5. Tooling & conventions

- **Lint/format = Biome** (NOT ESLint/Prettier): double quotes, semicolons. The PostToolUse harness
  formatter reflows TS and conflicts with Biome → **always `bun run lint:fix` before committing**.
- TSL typing is loose: chained node ops sometimes lose the fluent `.mul/.add` types. Use the local
  `fl()`/`roundVec()`/`vec3Array` helpers in `GpuEngine.ts` to re-wrap, and `as never` casts where
  the overloads are ambiguous. Atomic storage = `instancedArray(…, "uint").toAtomic()`.
- Scenes are pure data (`make({...overrides})` over `DEFAULT_CONFIG`) — fully reproducible.

---

## 6. Environment gotchas (bitten by these)

- `bun install` default backend has produced **corrupted/partial** extraction here (missing
  package.json for react/@types/react/@webgpu/types). Fix:
  `rm -rf node_modules bun.lock && bun pm cache rm && bun install --backend=copyfile`.
- Three.js 0.184 ships **no .d.ts** → `@types/three@^0.184.1` provides `three/webgpu` + `three/tsl`.
- Playwright `webServer` build can hang under machine contention → prefer manual
  `vite build` + background `bun run preview` + reuse; kill port-4173 zombies between runs
  (`lsof -ti :4173 | xargs -r kill -9`). Kill stray headed `Chromium` too.
- Heavy atomistic tests can **time out under parallel contention** (they pass in isolation). Give
  them generous per-test timeouts (45–60 s) rather than lowering below the 30 s global.
- `_shoot.mjs` (the headed screenshot scratch script) is git-ignored — keep it out of commits.

---

## 7. Commit & docs conventions

- Commit **at the end of each phase**; subject `Pn: <what>`; body explains what + why + deviations.
- Required trailers on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Cph9L43wotGgSHmHRiLADr
  ```
- Keep **`tracking.md`** updated (per-phase status + deviations) and `docs/PLAN*.md` as the roadmap.
- Be honest in docs and reports: if something isn't fixed (e.g. L6 oil/water is still CPU-only),
  say so and explain the fallback — "correct but slower" beats "fast but wrong".
