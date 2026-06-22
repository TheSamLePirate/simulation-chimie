# Suivi des phases — Dynamique-Chimie

Journal d'avancement par phase et **déviations au plan** ([`docs/PLAN.md`](docs/PLAN.md)).
Chaque phase se termine par un commit dédié.

Légende : ⬜ à faire · 🟡 en cours · ✅ terminé

| Phase | Intitulé | État |
|-------|----------|------|
| **P0** | Scaffold + CI + bootstrap WebGPU | ✅ |
| **P1** | Cœur + L0/L1 (moteur CPU) | ⬜ |
| **P2** | Moteur GPU + cell-lists | ⬜ |
| **P3** | L2 Lennard-Jones | ⬜ |
| **P4** | L3/L4 eau & démixtion huile | ⬜ |
| **P5** | L5 ensembles (thermostats/barostats) | ⬜ |
| **P6** | Édition + scènes + E2E complet | ⬜ |
| **P7** | L6 gros-grain (perf) | ⬜ |
| **P8** | Polish AAA | ⬜ |

---

## P0 — Scaffold + CI + bootstrap WebGPU ✅

**Objectif (DoD) :** l'app démarre, WebGPU est détecté, ≥ 1 test vert, CI verte.

**Livré :**
- Projet Bun + Vite + React 19 + TypeScript `strict` (+ `noUnusedLocals/Parameters`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- Outillage qualité : **Biome** (lint + format), **Vitest** (happy-dom, couverture v8),
  **Playwright** (Chromium WebGPU).
- CI **GitHub Actions** : job `quality` (lint · typecheck · unit · build) + job `e2e` (Playwright).
- Bootstrap **WebGPU** : `SimulationView` (Three.js `WebGPURenderer`) rend une **cellule de
  simulation périodique** (boîte fil-de-fer) + axes + éclairage, boucle d'animation + OrbitControls,
  HUD d'état moteur (`initializing → running / unsupported / error`), robuste au double-montage
  StrictMode et au redimensionnement.
- Premier module du **cœur physique** : `core/units.ts` (constantes, unités internes nm/ps/u/kJ·mol⁻¹/K,
  `temperatureFromKinetic` via équipartition) + tests unitaires.
- E2E : chargement de l'app + résolution d'un statut moteur non bloquant.

**Vérifications locales :** `bun run lint` · `bun run typecheck` · `bun run test` · `vite build` — voir commit.

**Déviations au plan :**
- _Choix d'outillage_ : **Biome** retenu plutôt qu'ESLint + Prettier (un seul outil, rapide). Conforme
  à l'option « ESLint **ou** Biome » du plan.
- `noUncheckedIndexedAccess` laissé **désactivé** volontairement : il rend l'indexation des tableaux
  typés (`Float32Array`) très verbeuse dans les boucles physiques chaudes. La justesse des bornes est
  couverte par les tests. À ré-évaluer si des bugs d'indexation apparaissent.
- E2E WebGPU en CI : le test P0 reste **tolérant** (accepte `unsupported`/`error`) car WebGPU headless
  sous Linux/CI est instable. Les assertions physiques E2E strictes arriveront en P6.

---

## Modèle pour les phases suivantes

```
## Pn — Titre  🟡/✅
**Objectif (DoD) :** …
**Livré :** …
**Vérifications :** …
**Déviations au plan :** … (ou « aucune »)
```
