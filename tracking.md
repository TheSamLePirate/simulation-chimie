# Suivi des phases — Dynamique-Chimie

Journal d'avancement par phase et **déviations au plan** ([`docs/PLAN.md`](docs/PLAN.md)).
Chaque phase se termine par un commit dédié.

Légende : ⬜ à faire · 🟡 en cours · ✅ terminé

| Phase | Intitulé | État |
|-------|----------|------|
| **P0** | Scaffold + CI + bootstrap WebGPU | ✅ |
| **P1** | Cœur + L0/L1 (moteur CPU) | ✅ |
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

## P1 — Cœur physique + L0/L1 (moteur CPU) ✅

**Objectif (DoD) :** cœur pur (unités, vec3, PBC, RNG, Verlet, observables) + moteur CPU + gaz
parfait/sphères molles + rendu particules + graphes T/énergie ; tests unitaires + physiques verts.

**Livré :**
- **Cœur physique** (`src/core/`, 100 % pur, Float64) : système d'unités GROMACS (nm/ps/u/kJ·mol⁻¹/K) ;
  boîte cubique + image minimale/wrap ; RNG mulberry32 + gaussien ; espèces (Argon, Néon) ;
  état SoA ; **Velocity-Verlet** ; forces **L0 (gaz parfait)** et **L1 (WCA)** avec mélange
  Lorentz-Berthelot ; bords **périodiques** & **réfléchissants** (avec mètre d'impulsion mural) ;
  observables T, énergies, **pression viriel**, impulsion, COM ; initialisation lattice + Maxwell-Boltzmann.
- **Moteur CPU** (`src/engine/cpu/CpuEngine.ts`) : l'oracle déterministe, niveaux commutables,
  réglages live (pas de temps, re-thermalisation), reset.
- **Temps réel** : `Simulation` (contrôleur playback) + `SimulationView` (rendu Three WebGPU,
  `InstancedMesh` mis à jour depuis le buffer SoA, reconstruction au changement structurel) +
  store **Zustand**.
- **UI** : panneau de contrôle (lecture/pause/pas/reset, niveau, bord, espèce, sliders N/T/taille/
  pas de temps/sous-pas), panneau d'**observables**, **graphes temps réel** (T, énergies, pression)
  dessinés sur canvas.
- **Tests** : **28 unitaires/golden** (force WCA vs dérivée numérique, conservation d'énergie <1 %,
  conservation d'impulsion, **déterminisme bit-à-bit**, équipartition, **P·V=N·k·T mesurée aux parois**,
  moteur CPU) + **2 E2E** (shell + avancement réel de la simulation sous WebGPU, zéro exception page).

**Vérifications :** `lint` · `typecheck` · **28 tests** · `build` · **2 E2E** — tout vert.
Statut moteur observé en E2E : **« WebGPU actif »** (le rendu instancié + boucle tournent réellement).

**Déviations au plan :**
- **Graphes** : composant canvas maison sans dépendance plutôt qu'uPlot/visx (plus léger, zéro dep).
  Choix réversible si on veut des axes/zoom riches plus tard.
- **Perf moteur CPU** : forces L1 en **O(N²)** (référence). Défaut N=256 pour rester fluide ; le slider
  monte à 1024 mais devient lourd — résolu en **P2** (GPU + cell-lists O(N)).
- **Température** : le slider applique un **rescale instantané** des vitesses (thermostat manuel). Les
  vrais thermostats NVT/NPT arrivent en **P5**.
- **Formateur** : Biome aligné sur guillemets doubles + points-virgules pour coller au formateur de
  l'environnement (évite les allers-retours de style).

---

## Modèle pour les phases suivantes

```
## Pn — Titre  🟡/✅
**Objectif (DoD) :** …
**Livré :** …
**Vérifications :** …
**Déviations au plan :** … (ou « aucune »)
```
