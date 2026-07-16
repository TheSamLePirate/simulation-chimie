# AAA Quality Program — execution log

Authoritative implementation log for the approved AAA plan (`P64`–`P92`). This file records progress, verification evidence, issues, and deviations at every phase. A phase is marked complete only when its full Definition of Done is satisfied and committed.

## Program rules

- Implement phases in approved dependency order.
- Add tests before or with each correction.
- Run lint, typecheck, full unit/golden tests, build, relevant e2e, and headed verification for GPU/render changes.
- Record measured evidence; never promote expectations to results.
- Record all issues and deviations honestly. Target deviation count: **0**.
- Keep invalid or uncertified capabilities disabled/explicitly labeled until their acceptance gates pass.

## Baseline at program start

- HEAD: `a23e4fa` (`P63: add reproducible L11 batch campaign`).
- Working tree: clean.
- Unit/golden: **168/168 passed**.
- E2E: **8 passed, 12 quantitative GPU tests skipped**.
- Build: green; production JS ≈ **1.26 MB raw**, chunk warning present.
- Coverage (excluding the timed-out NaCl stress test): **60.63% lines / 50.24% branches / 34.48% functions**; `src/core` ≈ **98.78% lines**.
- Standard `bun run test:cov`: fails because `src/core/forces/minImage.test.ts` exceeds its explicit/global 30 s timeout under V8 coverage (~32 s).
- Quick L11 campaign: operational software smoke test only (`N=8`, 0.004 ps production); not scientific evidence.

## Phase status

| Phase | Title | Status | Issues | Deviations |
|---|---|---|---:|---:|
| P64 | Scientific containment and immediate visible correctness | ✅ Done | 1 resolved | 0 |
| P65 | Canonical strict versioned configuration | ✅ Done | 1 resolved | 0 |
| P66 | Universal backend-neutral `BuiltSystem` | ✅ Done | 2 resolved | 0 |
| P67 | Explicit topology exclusions and 1–4 interactions | ✅ Done | 1 resolved | 0 |
| P68 | Exhaustive config transition planner | ⬜ Pending | 0 | 0 |
| P69 | Transactional rebuilds and `runId` | ⬜ Pending | 0 | 0 |
| P70 | CPU/L11 checkpoint v2 | ⬜ Pending | 0 | 0 |
| P71 | Serialized GPU lifecycle | ⬜ Pending | 0 | 0 |
| P72 | Capability catalog and backend truth | ⬜ Pending | 0 | 0 |
| P73 | Complete molecular rendering | ⬜ Pending | 0 | 0 |
| P74 | Constraint-aware DOF and initialization | ⬜ Pending | 0 | 0 |
| P75 | Constraint diagnostics and RB robustness | ⬜ Pending | 0 | 0 |
| P76 | GPU physics parity closure | ⬜ Pending | 0 | 0 |
| P77 | Valid constrained Langevin | ⬜ Pending | 0 | 0 |
| P78 | Correct pressure tensors | ⬜ Pending | 0 | 0 |
| P79 | Valid molecular barostat | ⬜ Pending | 0 | 0 |
| P80 | Level-specific observables | ⬜ Pending | 0 | 0 |
| P81 | Shared Float64 L11 estimator | ⬜ Pending | 0 | 0 |
| P82 | Resumable statistical campaign | ⬜ Pending | 0 | 0 |
| P83 | OpenMM/GROMACS validation | ⬜ Pending | 0 | 0 |
| P84 | Complete L11 acceptance campaign | ⬜ Pending | 0 | 0 |
| P85 | Harness isolation and CI hardening | ⬜ Pending | 0 | 0 |
| P86 | Component/a11y/coverage gates | ⬜ Pending | 0 | 0 |
| P87 | CPU browser fallback/device recovery | ⬜ Pending | 0 | 0 |
| P88 | Real-hardware GPU certification | ⬜ Pending | 0 | 0 |
| P89 | Visual regression | ⬜ Pending | 0 | 0 |
| P90 | Bundle/performance/leak budgets | ⬜ Pending | 0 | 0 |
| P91 | Generated capability documentation | ⬜ Pending | 0 | 0 |
| P92 | Release provenance/security/rollback | ⬜ Pending | 0 | 0 |

---

## P64 — Scientific containment and immediate visible correctness ✅

**Objective:** stop presenting known-invalid or incomplete paths as certified, while fixing the immediate GPU molecular atom-cardinality defect.

### Delivered

- **`src/engine/scientificStatus.ts` (new)** — single P64 containment authority: level classification (molecular/constrained), the uncertified-combination list, runtime containment, observable-availability reasons, and the `demo`/`kernel-validated`/`cross-engine-validated`/`accepted` vocabulary that P72 will absorb into the full capability catalog. No level is `accepted` yet.
- **GPU atom-count defect fixed** — `GpuParticleSystem` instances `engine.atomCount` instead of `config.particleCount`. Molecular GPU scenes previously rendered only a third of their atoms.
- **Uncertified combinations blocked** — molecular NPT and constrained Langevin are rejected by the Zod schema on import and cannot be selected in the UI; internal patches are contained through certified fallbacks (`langevin → csvr`, `berendsen → none`).
- **GPU temperature no longer lies** — the GPU target temperature is constructor-bound, so the control panel and the L11 lab now trigger a rebuild instead of calling a silent no-op setter. P68/P76 replace this with the full transition planner.
- **Incomplete observables marked unavailable** — constrained/L11 pressure and GPU flexible-molecular energies render as `Indisponible`/`Incomplète` with a visible reason instead of a misleading number.
- **GPU L11 relabeled** — "GPU · production" → "GPU · aperçu trajectoire", with a `GPU · APERÇU NON CERTIFIÉ` badge, disabled sampling, and γ/ρ(z) shown as unavailable in that mode.
- **Claims corrected** — README, `CLAUDE.md`, `AGENTS.md`, level descriptions, the L11 scene description, and the exporter no longer assert unqualified "complete round-trippable snapshots", "production" GPU L11, or "réelle" molecular thermodynamics.

### Verification evidence (measured)

| Gate | Result |
|---|---|
| `bun run lint` / `typecheck` | green |
| `bun run test` | **176/176 passed** (168 baseline + 8 new) |
| `bun run build` | green |
| `bunx playwright test` | **8 passed, 12 skipped** (pre-existing GPU skips, P88) |
| GPU vs CPU rendered atoms, headed | L4 **375/375**, L5 **450/450**, L7 **510/510** = `molecules × 3` (was 125/150/170 on GPU) |
| L11 GPU status badge, headed | `GPU · APERÇU NON CERTIFIÉ` |
| L11 GPU sampling button, headed | disabled |
| L5 Langevin / NPT controls, headed | both disabled |
| L5 pressure metric, headed | `Indisponible` |
| L5 scientific status, headed | `Démonstration qualitative` |
| Page errors during headed run | **0** |

New tests: 5 in `src/engine/scientificStatus.test.ts`, 2 schema-rejection tests in `src/state/snapshot.test.ts`, 1 atom-count contract test in `src/engine/gpu/GpuEngine.test.ts`. The e2e L11 test now asserts the preview labeling and disabled GPU sampling.

### Issues

1. **Resolved — instance-count probe returned `null`.** The first headed probe filtered on `SphereGeometry`, but the particle meshes use `IcosahedronGeometry`; the probe was wrong, not the fix. Corrected, then confirmed 375/450/510. A temporary `window.__mdScene` hook was used for the measurement per `CLAUDE.md` §4, then removed; the production bundle was checked to contain zero occurrences of it. A permanent unit test now pins `atomCount === 3 × particleCount` for L4 so the defect cannot silently return before P73 adds the render-level e2e assertion.

### Deviations

None.

### Carried forward (by design, not deviation)

- `metric-count` still displays the configured entity count (molecules), which is the known mislabeling P73 addresses with separate molecule/atom metrics.
- GPU temperature currently rebuilds rather than updating live; P68/P76 own the real fix.
- The 12 quantitative GPU e2e tests remain skipped until P88 provides a hardware runner.

---

## P65 — Canonical strict versioned configuration ✅

**Objective:** make a configuration mean exactly one thing, so scenes, imports, and (later) snapshot restores install exactly what they state.

### Delivered

- **`src/state/canonicalConfig.ts` (new)** — versioned envelope (`CONFIG_VERSION = 1`). Optional fields serialise explicitly as `null` instead of being dropped by `JSON.stringify`, which is what allowed an import to inherit the previous scene's values. Legacy bare configs are still accepted and normalised. `describeConfigError` turns Zod's JSON dump into readable text.
- **Strict schema** — `z.strictObject` rejects unknown keys rather than silently stripping them; species are validated against `SPECIES_LIBRARY` instead of silently falling back to argon.
- **Cross-field validation** — L9/L10 cannot request the GPU (no dihedral/Morse kernels); L11 requires an even molecule count; L1/L2 periodic boxes must fit their own uncapped cutoff. P64's containment rules are preserved.
- **`replaceConfig` vs `patchConfig`** — the store now separates "install a complete config" from "edit one field". Scene loads and imports replace; UI controls still patch.
- **Cutoff constants exported** — `LJ_CUTOFF_FACTOR` / `WCA_CUTOFF_FACTOR` are exported from the force modules so validation derives its limit from the same source the physics uses, instead of duplicating magic numbers.

### Verification evidence (measured)

| Gate | Result |
|---|---|
| `bun run lint` / `typecheck` | green |
| `bun run test` | **189/189 passed** (176 → +13) |
| `bun run build` | green |
| `bunx playwright test` | **8 passed, 12 skipped** |
| Every registry scene round-trips through JSON | asserted for all 15 scenes, identity |
| Import clears a stale optional field, headed | E-field active before import → **absent after** importing a config without it |
| Unknown species import, headed | refused: `Import refusé : speciesName : Espèce inconnue (attendu : ARGON, NEON, …)` |
| Export envelope, e2e | `configVersion: 1`, `electricField: 150`, `initialClump: null` (explicit, not omitted) |
| Page errors during headed run | **0** |

### Issues

1. **Resolved — my first minimum-image rule was wrong, not the scenes.** I initially rejected any periodic molecular box below ~1.84 nm, which failed the shipped L5 (1.7 nm) and L11 (1.8 nm) scenes. Reading the force code showed `molecular.ts`/`ionic.ts` **clamp** the cutoff to 0.49·L (a documented accuracy reduction, valid), while only `wca.ts`/`lennardJonesCell.ts` apply an unclamped cutoff and can genuinely double-count across the image. The rule now targets exactly those levels and derives its threshold from the exported cutoff constants. Tests pin both directions: L2 @1.6 nm rejected, L2 @1.75 nm and L5 @1.7 nm accepted.

### Deviations

None.

### Carried forward (by design, not deviation)

- The snapshot schema still embeds a bare config and remains v1; P70 introduces checkpoint v2 with the RNG/analysis state and its own migration.
- `make()` in the scene registry still lists optional fields explicitly. This is now a completeness guarantee (a scene is a full config), not a merge workaround; the comment was corrected to say so.

---

## P66 — Universal backend-neutral `BuiltSystem` for L0–L11 ✅

**Objective:** remove the duplicated CPU/GPU system construction so the two engines cannot drift apart, and represent every level's physics losslessly in one Float64 model.

### Defect this closed (measured, not theoretical)

`buildSystem` had **no L9/L10 branches**: both fell through to the monatomic path. The new lock-step tests caught it immediately —

| Level | Shared builder produced | CPU engine produced |
|---|---:|---:|
| L9 alkane (6 chains × 9 C) | **6 atoms** | 54 atoms |
| L10 Morse (12 diatomics) | **12 atoms** | 24 atoms |

The GPU would have built bare argon for an alkane system. It never surfaced only because `gpuSupportsConfig` blocks L9/L10 — the shared "single source of truth" was quietly wrong for two levels.

### Delivered

- **Canonical Float64 `BuiltSystem`** — carries `BondList` (incl. `morseA`), `AngleList`, `DihedralList`, `DistanceConstraints`, molecule ids, render bonds, `atomCount`, and a `forceSpec`. Precision-independent: no Float32 in the canonical model.
- **`ForceSpec`** — a discriminated union stating how a level's forces are evaluated. Both engines read it instead of re-deriving level→physics.
- **Exhaustive `switch` over `AccuracyLevel`** — L0–L11 each build their own system; TypeScript now fails the build if a new level is added without a branch. No fall-through remains.
- **`toGpuTopology()` adapter** — Float32/GPU packing moved downstream of construction; `GpuEngine` narrows through it.
- **`CpuEngine` consumes the shared builder** — its six duplicated builder branches are gone. It now imports **zero** system builders (was: alkane, dissolution, mixture, morseDiatomic, water, tip4p2005). `configure()` shrank from ~180 lines to ~50; `initialise()` was deleted as dead.
- **`monatomicForceSpec()`** — shared by the builder and the CPU engine's live level swap, so a level means the same physics wherever applied, rather than a second mapping reappearing in `setLevel`.

### Verification evidence (measured)

| Gate | Result |
|---|---|
| `bun run lint` / `typecheck` | green |
| `bun run test` | **199/199 passed** (189 → +10) |
| `bun run build` | green |
| `bunx playwright test` | **8 passed, 12 skipped** |
| Lock-step CPU ↔ builder | **all 12 levels** (was 6): state, typeIds, positions/velocities to 1e-10, box lengths + boundary, species, moleculeId, render-bond count |
| L9 topology | dihedrals present, `c.length === 6 × count` |
| L10 topology | 6 bonds, all `morseA > 0` |
| L5 topology | constraints present, zero spring bonds |
| GPU packing | Float64 canonical → Float32 flat, counts preserved |
| GPU physics headed | L5 **326.9 K**, NaCl **290.7 K**, dissolution **392.3 K** — all physical, steps advancing, **0 page errors** |

### Issues

1. **Resolved — the NaCl stability test failed the full suite at 41 s.** I did not assume it was the known flake: I measured the same test on HEAD vs the working tree — **8.84 s before, 8.86 s after**, i.e. my refactor caused no slowdown. The failure was CPU contention from my own background browser runs (the documented `CLAUDE.md` §6 hazard). Applied the remedy that file prescribes — a generous per-test timeout (30 s → 90 s) — so contention reads as "slow", never as "bad physics". P85 still owns proper CI sharding.
2. **Resolved — `setLevel` would have reintroduced a second force mapping.** The live monatomic force swap could not call `makeForceModel(built)`. Rather than hand-writing a parallel `level → ForceModel` switch (exactly the duplication P66 removes), I extracted `monatomicForceSpec()` and both call sites share it.

### Deviations

None.

### Carried forward (by design, not deviation)

- L11 still constructs `SurfaceTensionExperiment`, which builds its own slab internally; the shared builder defines the same L11 system and the lock-step test pins them together. P81 unifies the estimator.
- `MolecularForce` still receives whole-molecule exclusions; explicit 1–2/1–3/1–4 pair policy is P67, which now has one place to land.

---

## P67 — Explicit topology exclusions and 1–4 interactions ✅

**Objective:** stop using molecule identity as a nonbonded pair policy, and restore the intrachain physics that identity-based exclusion deleted.

### The defect this closed

`MolecularForce` skipped **every** same-molecule pair. Molecule identity is not a pair policy: in a 9-carbon chain, atoms 1–5 and further apart must interact, and that intrachain excluded volume is precisely what stops a chain passing through itself and sets its conformer populations. L9 was therefore not the TraPPE model it declares.

**Reference convention (not invented).** The alkane parameters are explicitly TraPPE-UA and match the published values: C–C 0.154 nm, C–C–C 114°, kθ = 519.6 kJ·mol⁻¹·rad⁻² (≡ 62500 K/rad²), CH₃ σ=0.375/ε=98 K·k_B, CH₂ σ=0.395/ε=46 K·k_B, charges 0. TraPPE computes intramolecular LJ **only for beads separated by more than three bonds** (Martin & Siepmann 1998) — 1-2/1-3/1-4 are excluded outright, with **no** OPLS-style scaled 1-4, because the RB torsion is fitted with the 1-4 LJ already removed. Re-adding a scaled 1-4 would double-count, so none was added.

### Delivered

- **`src/core/topology.ts` (new)** — exclusions derived by breadth-first walk of the bond graph to `EXCLUDED_BOND_DEPTH = 3`. The graph is built from **bonds ∪ constraints**: rigid water carries no springs, so a bonds-only graph would have left a molecule's own O and H interacting through LJ/Coulomb.
- **`MolecularForce` consults the policy**, gated behind the cheap `moleculeId` compare so the common inter-molecular case stays a single integer test and the O(N²) hot path is unaffected.
- **`BuiltSystem.exclusions`** — one classification, produced by the canonical builder (P66) and shared by both engines.
- **GPU shortcut is now asserted, not assumed** — the kernel excludes by `moleculeId`, which equals the topology answer only while no molecule holds two atoms more than 3 bonds apart. `GpuEngine` now throws if that ever stops holding, so enabling a longer-chain level on the GPU fails loudly instead of silently deleting its 1-5+ pairs.
- **L10 dissociation defined explicitly** — a broken Morse pair stays bonded in the topology and therefore stays excluded, regardless of separation. That is the standard non-reactive MD convention; it is now stated and tested rather than an accident of `moleculeId`.

### Verification evidence (measured)

| Gate | Result |
|---|---|
| `bun run lint` / `typecheck` | green |
| `bun run test` | **215/215 passed** (199 → +16) |
| `bun run build` | green |
| `bunx playwright test` | **8 passed, 12 skipped** |
| Pair classes (nonane) | 1-2/1-3/1-4 excluded, 1-5…1-9 interact; **15 of 36** intrachain pairs restored |
| L9 force change | explicit vs legacy policy on the same state: max force delta **> 0**, potential energy differs |
| L4/L5/L6/L8/L10 | `allIntramolecularExcluded === true`, and L6/L8/L10 molecular forces **bit-identical** (energy, virial, every force component) before/after |
| Rigid water via constraints | O–H and H–H excluded with zero spring bonds |
| TIP4P/Ewald goldens | unchanged, green |
| L9 headed | **467.7 K** vs 450 K target (~0.4σ for 72 atoms), PE finite, stable, **0 page errors** |
| GPU molecular headed | L5 **288.8 K**, dissolution **364.5 K** — assertion does not fire, physics unchanged |

### Issues

1. **Resolved — my first L9 physics test was unsound and passed for the wrong reason.** It moved atom 1 twenty nm away to isolate the 0–4 pair, but atom 0 is *bonded* to atom 1, so a huge bond force dominated index 0 and the assertion passed while proving nothing about the 1-5 LJ. Replaced with a direct differential measurement: evaluate the same state with the explicit policy and with the legacy molecule-wide rule, and compare. That isolates exactly the 1-5+ contribution, and the same method proves the small-molecule levels are bit-identical.

### Deviations

None.

### Carried forward (by design, not deviation)

- GPU keeps the `moleculeId` shortcut (correct for every level it supports, now asserted). An uploaded exclusion table is only needed if a >4-atom-molecule level is ever GPU-enabled.
- Independent OpenMM/GROMACS confirmation of the TraPPE pair classes and conformer populations is P83; P67 grounds the convention in the published model and pins the classes with fixtures.
