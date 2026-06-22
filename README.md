# Dynamique-Chimie

Simulateur de **dynamique moléculaire temps réel**, scientifiquement fondé : démixtion huile/eau,
changements d'état, diffusion, tension de surface, mouvement Brownien — en unités physiques réelles,
avec observables mesurables et reproductibilité.

> Calcul sur **GPU (WebGPU compute)**, rendu **Three.js**, UI **React** — TypeScript strict, Bun, Vite.

## Statut

Le développement est **incrémental par niveaux de justesse physique** (L0 gaz parfait → L6 gros-grain).
Voir le plan d'architecture dans [`docs/PLAN.md`](docs/PLAN.md) et l'avancement dans
[`tracking.md`](tracking.md).

## Prérequis

- [Bun](https://bun.sh) ≥ 1.3
- Un navigateur **WebGPU** (Chrome/Edge ≥ 123, Safari ≥ 26, Firefox récent)

## Démarrage

```bash
bun install
bun run dev        # serveur de dev Vite
```

## Scripts

| Commande | Rôle |
|----------|------|
| `bun run dev` | Serveur de développement (HMR) |
| `bun run build` | Typecheck + build de production |
| `bun run preview` | Sert le build de production |
| `bun run lint` / `bun run lint:fix` | Lint + format (Biome) |
| `bun run typecheck` | Vérification des types (app + outillage) |
| `bun run test` / `bun run test:watch` | Tests unitaires (Vitest) |
| `bun run test:cov` | Tests + couverture |
| `bun run e2e` | Tests end-to-end (Playwright + WebGPU) |
| `bun run check` | lint + typecheck + tests (pré-commit conseillé) |

## Architecture

```
src/
  core/     physique pure (unités, forces, intégrateurs, observables) — 100 % testée
  engine/   moteurs de simulation : CPU (oracle) · GPU (WebGPU/TSL)
  render/   rendu Three.js (WebGPURenderer)
  state/    config sérialisable, snapshots, RNG à graine
  scenes/   presets / scènes
  ui/        React (panneaux, graphes, mode édition)
```

Détails complets : [`docs/PLAN.md`](docs/PLAN.md).
