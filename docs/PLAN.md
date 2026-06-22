# Dynamique-Chimie — Simulateur de Dynamique Moléculaire Temps Réel

> Un simulateur de dynamique moléculaire **scientifiquement fondé**, **temps réel 3D**, qui montre
> la *vraie* physique : démixtion huile/eau, changements d'état, diffusion, tension de surface,
> mouvement Brownien — avec des unités physiques réelles et des observables mesurables.

**Statut :** plan d'architecture (v1) — 2026-06-23

---

## 0. Décisions fondatrices (validées)

| Axe | Décision | Conséquence |
|-----|----------|-------------|
| **Périmètre** | Dynamique moléculaire (molécules intactes, *pas* de réactions) | Pas de ReaxFF/quantique. Forces inter- et intra-moléculaires classiques. |
| **Exactitude** | Hybride : moteur **atomistique exact** + mode **gros-grain** "performance" | Deux moteurs derrière une interface commune. |
| **GPU** | **WebGPU compute** (Three.js `WebGPURenderer` + TSL) | Calcul N-corps + neighbor lists sur GPU. Pas de fallback compute WebGL2. |
| **Objectif** | Entre **pédagogie** et **quasi-recherche** | Forces activables une à une, graphes temps réel, observables exportables (CSV), reproductibilité (seeds, snapshots). |
| **Stack** | Three.js · React · TypeScript (strict) · Bun · Vite | + Vitest, Playwright, Zustand, Zod. |

---

## 1. Idée directrice : les **niveaux de justesse physique**

C'est la colonne vertébrale du projet. La physique est un **pipeline de termes de force composables**.
On peut activer/désactiver chaque terme indépendamment et monter en fidélité de façon incrémentale.

| Niveau | Physique ajoutée | Ce qu'on observe | Coût |
|--------|------------------|------------------|------|
| **L0 — Gaz parfait** | Translation balistique + parois/PBC, **aucune interaction** | Distribution de Maxwell-Boltzmann, loi PV=NkT | O(N) |
| **L1 — Sphères molles (WCA)** | Répulsion à courte portée (volume exclu, collisions) | Pression d'un gaz dense, empilement | O(N) (cell list) |
| **L2 — Lennard-Jones complet** | Van der Waals = répulsion + **cohésion** | Condensation gaz→liquide, coexistence de phases, RDF g(r) | O(N) |
| **L3 — Électrostatique** | Coulomb (charges partielles) via **Wolf DSF** | Structuration polaire, début des liaisons H | O(N) |
| **L4 — Molécules rigides** | Géométrie (eau SPC/E puis TIP4P/2005, alcane = billes LJ) + contraintes **SETTLE** / liaisons harmoniques raides | **Vraie eau**, **huile**, réseau de liaisons H, **démixtion huile/eau**, tension de surface | O(N) |
| **L5 — Ensembles** | Thermostats (CSVR/Berendsen) + barostats (Berendsen) → **NVT / NPT** | Contrôle T et P, **transitions de phase** (gel, ébullition), densité réaliste | O(N) |
| **L6 — Gros-grain (perf)** | MARTINI (4 atomes lourds → 1 bille) ou DPD | Démixtion/auto-assemblage à **grande échelle** (10⁵–10⁶ billes), µs simulées | O(N), Δt ×10–40 |

Chaque niveau = un *pass* de calcul supplémentaire branché sur le pipeline. L'UI expose les
interrupteurs (cases à cocher "van der Waals", "électrostatique", "contraintes", "thermostat"…).

---

## 2. Algorithmes de référence (issus de la recherche)

### Intégrateur — **Velocity Verlet** (symplectique, réversible, O(Δt²))
```
v(t+½Δt) = v(t) + ½ a(t) Δt        // demi-kick
x(t+Δt)  = x(t) + v(t+½Δt) Δt       // drift
a(t+Δt)  = F(t+Δt)/m                // recalcul des forces
v(t+Δt)  = v(t+½Δt) + ½ a(t+Δt) Δt  // demi-kick
```
Pas de temps : **1 fs** (sûr) à 2 fs (avec contraintes) pour l'eau atomistique ; 20–40 fs en gros-grain.
Sous-pas : plusieurs pas physiques par frame de rendu (découplage physique/affichage).

### Forces
- **Lennard-Jones 12-6** : `V = 4ε[(σ/r)¹² − (σ/r)⁶]`, **tronqué-décalé** à `r_c = 2.5σ`
  (force continue au cutoff). Mélange **Lorentz-Berthelot** : `σ_ij=(σ_i+σ_j)/2`, `ε_ij=√(ε_i ε_j)`.
- **Électrostatique** : méthode de **Wolf / Damped-Shifted-Force** — O(N), ~1 % d'erreur vs Ewald,
  **sans FFT** (PME écarté car trop coûteux/synchronisant sur GPU navigateur). κ ≈ 0,2 Å⁻¹.
- **Liaisons/angles** : eau rigide via **SETTLE** (analytique, idéal GPU) ou approximation par
  liaisons harmoniques très raides (plus simple à implémenter en premier).

### Voisinage — **cell lists** (linked cells) par **spatial hashing** sur GPU
Grille de cellules de côté `r_c + r_skin`. Construction GPU : hash 3D→1D, compteurs **atomiques**
(`atomicAdd`) + **prefix sum** (scan en mémoire partagée `workgroupArray`) → tri par cellule.
Parcours des 27 cellules voisines. **O(N)** au lieu de O(N²). Reconstruction quand le déplacement
cumulé max ≥ `r_skin/2`.

### Conditions aux limites
- **PBC + image minimale** (`r_ij −= L·round(r_ij/L)`), cutoff ≤ L/2 → comportement de volume,
  démixtion, tension de surface aux interfaces.
- **Parois réfléchissantes** (option pédagogique "boîte fermée").

### Ensembles / thermostats
- **CSVR (Bussi)** : rescale stochastique global — échantillonnage canonique correct (pédagogie).
- **Berendsen** : rescale simple, rapide (mode perf ; artefact "flying ice cube" toléré sur courte durée).
- **Barostat Berendsen** pour NPT (montre densité/transitions).

### Unités — **réelles** (Å, fs, kJ/mol, K)
Interprétables ("300 K, 7,9 Å, 1 fs"), validables contre l'expérience. Couche de conversion vers
unités internes du solveur. (Unités réduites LJ disponibles en option "physique pure".)

### Observables (validation + pédagogie)
- **Température** (équipartition, `T = Σ m v² / (3N_dof k_B)`, corriger `N_dof` des contraintes)
- **Pression** (viriel : `P = NkT/V + (1/3V)Σ r·F`)
- **Énergies** : cinétique, potentielle, totale (+ dérive = contrôle d'intégrateur)
- **g(r)** (fonction de distribution radiale — pic O-O de l'eau ~2,8 Å)
- **MSD → coefficient de diffusion** `D = (1/6) d⟨Δr²⟩/dt` (eau ~2,3×10⁻⁹ m²/s à 300 K)
- **Paramètre d'ordre de démixtion** (huile/eau), profil de densité, tension de surface interfaciale

---

## 3. Architecture logicielle

Principe : **cœur physique pur (TS) testable** + **moteurs interchangeables** (CPU référence / GPU)
+ **rendu** + **UI**. La physique ne dépend ni de React ni de Three.

```
src/
├─ core/                  # Domaine pur, zéro dépendance GPU/UI — 100% testé unitairement
│  ├─ units.ts            # constantes physiques, conversions (SI ↔ interne ↔ réduit)
│  ├─ forcefield/         # params LJ/charges par espèce, règles de mélange
│  ├─ molecules/          # définitions (eau SPC-E, TIP4P/2005, alcane CHn, ions…)
│  ├─ math/               # vec3, PBC image minimale, RNG compteur (PCG/philox)
│  ├─ integrators/        # velocity-verlet (formules pures, oracle de test)
│  ├─ forces/             # LJ, Coulomb-Wolf, liaisons/angles, contraintes (réf. CPU)
│  └─ observables/        # T, P viriel, énergies, g(r), MSD, ordre de démixtion
│
├─ engine/                # Abstraction de simulation
│  ├─ types.ts            # ISimulationEngine, SimConfig, SimState, Snapshot
│  ├─ cpu/                # moteur de RÉFÉRENCE (déterministe, oracle, petits N)
│  └─ gpu/                # moteur WebGPU/TSL (le vrai)
│     ├─ buffers.ts       # instancedArray pos/vel/force/type/charge (ping-pong)
│     ├─ passes/
│     │  ├─ cellList.ts   # spatial hash + atomics + prefix sum
│     │  ├─ forcesLJ.ts
│     │  ├─ forcesCoulomb.ts
│     │  ├─ bondsConstraints.ts
│     │  ├─ integrate.ts  # Verlet (2 demi-kicks)
│     │  ├─ thermostat.ts
│     │  └─ observables.ts# réductions GPU (Σ énergie, histogramme g(r))
│     └─ pipeline.ts      # ordonnancement des passes selon le niveau actif
│
├─ render/                # Three.js WebGPURenderer
│  ├─ renderer.ts         # init async, boucle, sous-pas
│  ├─ particles.ts        # InstancedMesh / PointsNodeMaterial lisant le storage buffer
│  ├─ surface.ts          # rendu de surface de fluide (écran, impostors/metaballs) — L tardif
│  ├─ bonds.ts            # liaisons covalentes (eau, alcanes)
│  ├─ box.ts              # boîte PBC, axes, échelle
│  └─ colorModes.ts       # par espèce / vitesse / charge / énergie / pression locale
│
├─ state/                 # État & reproductibilité
│  ├─ store.ts            # Zustand : config UI (sérialisable) vs runtime
│  ├─ schema.ts           # Zod : validation de SimConfig / Scene / Snapshot
│  ├─ snapshot.ts         # sérialisation déterministe (seed+config+step+pos+vel)
│  └─ rng.ts              # RNG à graine, reproductible
│
├─ scenes/                # Presets / scènes prêtes à l'emploi
│  ├─ registry.ts
│  ├─ idealGas.ts  ljLiquid.ts  pureWater.ts  oilWater.ts
│  ├─ droplet.ts  freezing.ts  boiling.ts  diffusion.ts  brownian.ts
│
├─ ui/                    # React
│  ├─ panels/             # niveau, interrupteurs de force, sliders T/P/N
│  ├─ graphs/             # T, énergies, P, g(r), MSD (temps réel)
│  ├─ playback/           # play/pause/step/vitesse/reset
│  ├─ editor/             # Mode Édition : placer molécules, régions, conditions initiales
│  ├─ scenePicker/        # galerie de presets
│  └─ exporter/           # CSV observables, snapshot JSON, capture PNG
│
├─ workers/               # analyses lourdes hors thread (g(r), MSD long)
└─ app/                   # composition root, layout, thème
```

### Séparation config / état
- **SimConfig** (sérialisable, Zod) : niveau, forces actives, espèces, N, T/P cible, boîte, seed,
  thermostat, Δt, cutoff. → *pilote* le moteur et *définit* une scène.
- **Runtime** : buffers GPU (positions/vitesses/forces) + observables dérivées. Non sérialisé en
  continu ; capturable en **Snapshot** à la demande.

### Déterminisme & reproductibilité
- Pas de temps fixe, **RNG à graine de type compteur** (état = `f(instanceIndex, frame, seed)`),
  ordre de réduction maîtrisé. Snapshot = `seed + config + step + positions + vitesses`.
- La virgule flottante GPU parallèle donne des écarts ~1 ULP entre exécutions → le **moteur CPU
  sert d'oracle bit-exact** pour les tests de régression ; le GPU est validé *par tolérance*.

---

## 4. Stratégie de tests (« full testing everywhere »)

| Niveau de test | Outil | Contenu |
|----------------|-------|---------|
| **Unitaire** | Vitest | Force LJ vs analytique ; règles de mélange ; image minimale PBC ; Verlet sur oscillateur harmonique (conservation d'énergie) ; T de Maxwell-Boltzmann ; viriel sur config connue ; g(r) sur réseau ; distribution du RNG. |
| **Validation physique (« golden »)** | Vitest (moteur CPU) | **NVE** : dérive d'énergie < seuil sur K pas. **Équipartition** : T mesurée ≈ cible. **Gaz parfait** : PV=NkT (L0). **LJ** : pression à (ρ,T) donnée vs littérature. **Eau** : densité ~997 kg/m³ (TIP4P/2005, 300 K/1 atm), 1er pic g(r) O-O ~2,8 Å, ordre de grandeur de D. **Huile/eau** : paramètre de démixtion croissant, interface qui se forme. **Conservation** de l'impulsion totale (PBC). |
| **Équivalence CPU↔GPU** | Vitest + WebGPU headless | Mêmes conditions initiales, petits N, K pas → écart < tolérance. Valide chaque kernel GPU contre l'oracle CPU. |
| **Snapshots** | Vitest | Round-trip sérialiser→restaurer→continuer = identique. **Séries temporelles d'observables figées par seed** (régression : « variables, states, snapshot »). |
| **Composants** | Vitest + Testing Library | Les contrôles UI modifient bien la config ; graphes ; mode édition. |
| **E2E simulation** | **Playwright** (Chromium WebGPU/Dawn) | Charger l'app → choisir un preset → lancer N pas → **asserter les observables dans la plage attendue** → **asserter le déterminisme** (même seed ⇒ même hash de trajectoire) → tester mode édition, export, changement de niveau → **régression visuelle** du canvas (avec tolérance). |
| **Propriétés** | fast-check | Invariants : pas de NaN, énergie bornée, particules dans la boîte (PBC), impulsion conservée. |
| **Performance** | bench + e2e | fps vs N ; budgets respectés ; pas de fuite mémoire GPU. |

CI (GitHub Actions) : lint + types + unitaires + physique à chaque push ; e2e WebGPU (Chromium
headless + Dawn/SwiftShader) sur PR.

---

## 5. Performance

- **O(N)** partout (cell lists, cutoff) ; **ping-pong** des buffers ; **pipelines persistants**
  (un `ComputeNode` réutilisé, jamais recréé en boucle) ; **fp32** ; tailles de workgroup ajustées.
- **Sous-pas** physiques par frame ; **zéro readback CPU** sauf échantillonnage périodique des
  observables ; rendu **instancié** ; LOD (impostors/points à grand N, sphères à petit N).
- Cibles indicatives : **60 fps** à ~50k atomes en L2 ; ~10–20k atomes en eau complète L4 + Coulomb ;
  **10⁵–10⁶ billes** en mode gros-grain L6 (objectif étendu).

---

## 6. Scènes / presets

1. **Gaz parfait en boîte** — Maxwell-Boltzmann, pression vs température (L0).
2. **Liquide de Lennard-Jones / condensation** — coexistence gaz-liquide, g(r) (L2).
3. **Eau pure** (SPC/E puis TIP4P/2005) — structure, réseau de liaisons H, g(r) O-O (L4).
4. **Huile + eau — démixtion** *(démo phare)* — séparation de phases, interface, tension de surface (L4-L5).
5. **Goutte / tension de surface** — gouttelette sphérique dans le vide (L4).
6. **Cristallisation / gel** — refroidir → structure ordonnée (L5).
7. **Ébullition / évaporation** — chauffer le liquide (L5).
8. **Diffusion** — tache de "colorant" qui s'étale ; mesure de D (L2-L4).
9. **Mouvement Brownien** — grosse particule bombardée par le solvant (L2-L4).
10. *(étendu)* **NaCl dans l'eau** (ions, électrostatique), **auto-assemblage** d'amphiphiles (gros-grain).

**Mode Édition** : placer/peindre des molécules, définir des régions (eau ici, huile là), fixer
T/densité initiales, dessiner des parois, puis sauver comme scène (SimConfig sérialisé).

---

## 7. Feuille de route incrémentale (chaque phase = livrable testé)

| Phase | Contenu | « Definition of done » |
|-------|---------|------------------------|
| **P0 — Scaffold** | Vite+React+TS strict, Bun, ESLint/Biome, Vitest, Playwright, CI, bootstrap `WebGPURenderer` async, boucle de rendu, boîte vide. | App démarre, WebGPU détecté, 1 test vert, CI verte. |
| **P1 — Cœur + L0/L1 (CPU)** | `core/` (units, vec3, PBC, RNG, Verlet, observables) + moteur **CPU** + gaz parfait/sphères molles + rendu particules + graphes T/énergie. | Tests unitaires + physique (PV=NkT, équipartition, conservation d'énergie) verts. |
| **P2 — Moteur GPU** | Portage Verlet + L1 en TSL compute, ping-pong, rendu instancié depuis storage buffer, **cell lists GPU**, tests d'équivalence CPU↔GPU. | GPU = CPU à tolérance près ; 50k particules fluides. |
| **P3 — L2 Lennard-Jones** | LJ complet tronqué-décalé, condensation, **viriel/pression**, **g(r)**. Presets gaz & liquide LJ. | Validation LJ vs littérature ; g(r) correct. |
| **P4 — L3/L4 Eau & Huile** | Coulomb-Wolf + charges, eau SPC/E→TIP4P/2005 (liaisons raides puis SETTLE), alcanes, **démixtion huile/eau**. | Densité de l'eau, pic g(r) O-O ~2,8 Å, démixtion mesurée. |
| **P5 — L5 Ensembles** | Thermostats CSVR/Berendsen, barostat, NVT/NPT, **gel & ébullition**, contrôle T/P. | Transitions de phase démontrées + tests. |
| **P6 — Édition, scènes, E2E** | Mode Édition complet, registre de scènes, snapshots/export CSV-PNG, **suite E2E Playwright** complète, régression visuelle. | E2E verte (observables + déterminisme + visuel). |
| **P7 — L6 Gros-grain** | MARTINI/DPD, très grands N, passe d'optimisation. | 10⁵+ billes fluides ; démos grande échelle. |
| **P8 — Polish AAA** | Rendu de surface de fluide, éclairage, post-FX, accessibilité, docs, tutoriels in-app. | Qualité « état de l'art ». |

---

## 8. Risques & parades

| Risque | Parade |
|--------|--------|
| TSL compute évolue vite (API r184) | Couche d'abstraction `engine/gpu/passes/*` fine ; vérifier la syntaxe TSL exacte contre la doc à chaque phase. |
| WebGPU absent (vieux navigateur) | Détection au démarrage + message clair ; moteur CPU pour très petits N en secours. |
| Déterminisme GPU imparfait (FP parallèle) | Oracle **CPU bit-exact** pour la régression ; GPU validé par tolérance ; seed + pas fixe. |
| Électrostatique coûteuse | **Wolf DSF** (O(N), pas de FFT) au lieu de PME. |
| Contraintes rigides difficiles sur GPU | Démarrer en **liaisons harmoniques raides**, migrer vers **SETTLE** ensuite. |
| Coût des tests E2E WebGPU en CI | Chromium+Dawn headless ; jeux de tests courts et déterministes. |

---

## 9. Stack technique détaillée

- **Runtime/PM** : Bun · **Build** : Vite · **Langage** : TypeScript `strict`
- **3D** : Three.js (`three/webgpu`, `three/tsl`) — `WebGPURenderer`, `instancedArray`, `Fn().compute()`
- **UI** : React · **État** : Zustand · **Validation** : Zod · **Graphes** : uPlot/visx (léger, temps réel)
- **Tests** : Vitest (+ Testing Library, fast-check) · Playwright (E2E WebGPU) · benchmarks
- **Qualité** : ESLint ou Biome · Prettier · Typedoc · hooks pré-commit · GitHub Actions CI
```
