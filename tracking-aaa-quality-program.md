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
| P65 | Canonical strict versioned configuration | ⬜ Pending | 0 | 0 |
| P66 | Universal backend-neutral `BuiltSystem` | ⬜ Pending | 0 | 0 |
| P67 | Explicit topology exclusions and 1–4 interactions | ⬜ Pending | 0 | 0 |
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
