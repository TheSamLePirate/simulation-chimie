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
| **L3** | Ions + Coulomb Wolf DSF | cristaux ioniques, électrophorèse |
| **L4–L8** | Eau moléculaire, contraintes, mélanges, interfaces, dissolution | liaisons H, gouttes, huile/eau, solvatation |
| **L9–L10** | Dièdres RB, liaisons Morse | conformations et dissociation (CPU) |
| **L11** | TIP4P/2005 + smooth PME + slab + Janeček + test-area | protocole γ(T) en validation ; aucun résultat de campagne encore accepté |

### Ensembles (thermostats)
- **NVE** (énergie constante), **Berendsen** et **CSVR/Bussi** (NVT canonique correct).
- Transitions de phase : cristallisation (refroidissement), évaporation (chauffage).

### Moteurs
- **CPU** : oracle déterministe Float64, **cell-lists O(N)**, multi-espèces, thermostats — le mode validé par défaut.
- **GPU** : WebGPU/TSL, Velocity-Verlet en compute shaders, **rendu GPU-résident**. L0–L8 et L11 ont
  des validations de noyaux/étapes contre l'oracle Float64, mais la certification quantitative sur
  matériel réel reste à automatiser ; L9/L10 et NPT restent CPU. L11 GPU est un aperçu de trajectoire,
  pas encore un producteur certifié de γ ou ρ(z).

### Scènes prêtes à l'emploi
Gaz parfait · Liquide Lennard-Jones · **Huile + Eau (démixtion)** · Cristallisation (NVT) · Chauffage / gaz.

### Observables temps réel
Température, pression (viriel), énergies (cin./pot./tot.), **g(r)**, **paramètre de démixtion**, FPS —
graphes temps réel sur canvas.

### Reproductibilité & export
Configurations **Zod-validées**, export **config JSON / snapshot CPU JSON / g(r) CSV** et import de
configuration. Le snapshot restaure exactement les trajectoires déterministes NVE ; la reprise exacte
CSVR/Langevin/L11 attend le checkpoint v2 avec état RNG et accumulateurs d'analyse.

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
| `bun run campaign:surface-tension` | Runner oracle CPU L11 (très coûteux aux paramètres complets) ; `--quick` = smoke test logiciel non physique |
| `bun run check` | lint + typecheck + tests |

## Validation scientifique

Les **tests « golden »** vérifient la vraie physique : conservation d'énergie NVE (< 1 %),
équipartition, **loi des gaz parfaits mesurée aux parois**, force LJ vs dérivée numérique,
g(r) normalisé, **démixtion croissante** d'un mélange immiscible, thermostats qui atteignent la cible,
cell-list **identique** à la référence O(N²), round-trip de snapshot NVE et déterminisme bit-à-bit
depuis un état initial commun.

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
