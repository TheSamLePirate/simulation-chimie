# Dynamique-Chimie

Simulateur de **dynamique moléculaire temps réel**, scientifiquement fondé : démixtion
huile/eau, condensation, changements d'état, diffusion, tension de surface, mouvement
Brownien — en **unités physiques réelles**, avec observables mesurables et reproductibilité.

> Calcul **CPU (oracle déterministe, Float64)** ou **GPU (WebGPU compute / TSL)**, rendu
> **Three.js**, UI **React** — TypeScript strict, Bun, Vite.

## Démarrage

```bash
bun install
bun run dev          # serveur de développement (HMR)
```

Prérequis : [Bun](https://bun.sh) ≥ 1.3 et un navigateur **WebGPU** (Chrome/Edge ≥ 123,
Safari ≥ 26, Firefox récent).

## Fonctionnalités

### Niveaux de justesse physique (forces activables incrémentalement)
| Niveau | Physique | Effets observables |
|--------|----------|--------------------|
| **L0** | Gaz parfait (aucune interaction) | Maxwell-Boltzmann, PV = N·k·T |
| **L1** | Sphères molles (WCA) | volume exclu, collisions |
| **L2** | Lennard-Jones 12-6 (force-décalée) | **cohésion, condensation, démixtion**, g(r) |

### Ensembles (thermostats)
- **NVE** (énergie constante), **Berendsen** et **CSVR/Bussi** (NVT canonique correct).
- Transitions de phase : cristallisation (refroidissement), évaporation (chauffage).

### Moteurs
- **CPU** : oracle déterministe Float64, **cell-lists O(N)**, multi-espèces, thermostats — le mode validé par défaut.
- **GPU** : WebGPU/TSL, Velocity-Verlet en compute shaders, **rendu GPU-résident** (positions lues
  dans le vertex shader, zéro readback) pour de grands comptes de particules.

### Scènes prêtes à l'emploi
Gaz parfait · Liquide Lennard-Jones · **Huile + Eau (démixtion)** · Cristallisation (NVT) · Chauffage / gaz.

### Observables temps réel
Température, pression (viriel), énergies (cin./pot./tot.), **g(r)**, **paramètre de démixtion**, FPS —
graphes temps réel sur canvas.

### Reproductibilité & export
Configurations **Zod-validées**, **snapshots d'état** complets round-trippables, export **config JSON /
snapshot JSON / g(r) CSV**, import de scène.

### Raccourcis clavier
`Espace` lecture/pause · `R` réinitialiser · `N` un pas · couleur des particules par **espèce** ou
**vitesse** (carte thermique bleu→rouge).

## Scripts

| Commande | Rôle |
|----------|------|
| `bun run dev` | Serveur de développement |
| `bun run build` | Typecheck + build de production |
| `bun run preview` | Sert le build de production (port 4173) |
| `bun run lint` / `lint:fix` | Lint + format (Biome) |
| `bun run typecheck` | Vérification des types |
| `bun run test` / `test:watch` | Tests unitaires + physiques (Vitest) |
| `bun run e2e` | Tests end-to-end (Playwright + WebGPU) |
| `bun run check` | lint + typecheck + tests |

## Validation scientifique

Les **tests « golden »** vérifient la vraie physique : conservation d'énergie NVE (< 1 %),
équipartition, **loi des gaz parfaits mesurée aux parois**, force LJ vs dérivée numérique,
g(r) normalisé, **démixtion croissante** d'un mélange immiscible, thermostats qui atteignent la cible,
cell-list **identique** à la référence O(N²), round-trip de snapshot, déterminisme bit-à-bit.

> Le moteur **CPU est l'oracle de référence** ; le moteur GPU est validé par dispatch et, en navigateur
> réel, par parité vs CPU (`window.__md`). Voir [`docs/PLAN.md`](docs/PLAN.md) et [`tracking.md`](tracking.md)
> pour l'architecture, la feuille de route et les déviations assumées.

## Architecture

```
src/
  core/     physique pure (unités, box/PBC, RNG, intégrateur, forces, thermostats, observables) — testée
  engine/   moteurs : cpu/ (oracle) · gpu/ (WebGPU/TSL)
  render/   Three.js (WebGPURenderer), drivers CPU/GPU, rendu instancié
  state/    config Zod, snapshots, store Zustand
  scenes/   presets
  ui/        React (scènes, contrôles, observables, graphes, export)
```
