# Suivi des phases — Dynamique-Chimie

Journal d'avancement par phase et **déviations au plan** ([`docs/PLAN.md`](docs/PLAN.md)).
Chaque phase se termine par un commit dédié.

Légende : ⬜ à faire · 🟡 en cours · ✅ terminé

| Phase | Intitulé | État |
|-------|----------|------|
| **P0** | Scaffold + CI + bootstrap WebGPU | ✅ |
| **P1** | Cœur + L0/L1 (moteur CPU) | ✅ |
| **P2** | Moteur GPU (cell-lists reportées) | ✅ |
| **P3** | L2 Lennard-Jones | ✅ |
| **P4** | Démixtion huile/eau (eau atomistique/électrostatique reportées) | ✅ |
| **P5** | L5 ensembles — thermostats NVT (barostat reporté) | ✅ |
| **P6** | Snapshots/export + sauvegarde de scènes + E2E | ✅ |
| **P7** | Perf : cell-lists O(N) CPU (gros-grain MARTINI/DPD reporté) | ✅ |
| **P8** | Polish (viz vitesse, raccourcis, docs) | ✅ |
| **P9** | L3 électrostatique (Coulomb-Wolf) + ions | ✅ |
| **P10** | L4 eau atomistique (SPC/Fw : molécules, liaisons, charges) | ✅ |
| **P11** | Barostat NPT (Berendsen) — ensemble pression constante | ✅ |
| **P12** | Gravité (champ externe, CPU + GPU) | ✅ |
| **P13** | Eau rigide L5 (contraintes SHAKE/RATTLE) | ✅ |
| **P14** | Polish visuel (éclairage hémisphérique + tone mapping ACES) | ✅ |
| **P15** | GPU cell-lists O(N) (spatial hash + atomics) + thermostat GPU | ✅ |
| **P16** | Rendu de surface de fluide (metaballs écran-espace) | ✅ |
| **P17** | Réalisme : molécules réelles + démixtion huile/eau + corrections physiques + GPU honnête | ✅ |
| **P18** | Gouttelette (tension de surface L7) + cell-list CPU pour les forces atomistiques + repli GPU honnête | ✅ |
| **P19** | GPU multi-espèces + Coulomb (Wolf DSF, erfc en TSL) + rendu par espèce | ✅ |
| **P20** | Dissolution d'un cristal de sel (NaCl) dans l'eau (L8) | ✅ |
| **P21** | Cell-list GPU : diagnostiqué (binning OK, kernel de force faux) ⇒ gardé désactivé (brute correct) | ✅ |
| **P22** | Sédimentation thermostatée + docs (CLAUDE.md) | ✅ |
| **P23** | Les presets MONTRENT l'effet : T initiale ≠ cible, gouttelettes (initialClump), sphères plus petites | ✅ |
| **P24** | Correction blow-up cristal serré (image minimale : cutoff LJ ≤ L/2) + mode couleur « Structure » + couleur auto par scène | ✅ |
| **P25** | Correction fuite de config entre scènes (initialClump rémanent ⇒ NaCl explosait) | ✅ |
| **P26** | Forces moléculaires sur GPU : eau atomistique L4 sur WebGPU (liaisons/angles via atomics i32, exclusions) | ✅ |
| **P27** | Eau rigide sur GPU (SHAKE/RATTLE par molécule) ⇒ L5/L7/L8 sur WebGPU | ✅ |
| **P28** | Parois réfléchissantes sur GPU ⇒ le GPU couvre 8/9 niveaux (tout sauf huile/eau L6) | ✅ |
| **P30** | Cell-list GPU O(N) RÉPARÉ (tri-particules) ⇒ 16k atomes monoatomiques à ~87 FPS | ✅ |
| **P31** | Cell-list pour le moléculaire (avec exclusions) ⇒ 4000 molécules d'eau (12k atomes) à 120 FPS | ✅ |
| **P32** | Correction GPU==CPU : le GPU ne fait QUE le monoatomique (vérifié identique au CPU) ; moléculaire → CPU (dérive float32) | ✅ |
| **P33** | Nouvelles forces : champ électrique (q·E) + thermostat de Langevin/mouvement brownien (CPU + GPU) + démos | ✅ |
| **P34** | Nouvelles forces : dièdres (Ryckaert-Bellemans, L9 alcane) + liaisons de Morse (L10 dissociation) (CPU) + démos | ✅ |
| **P35** | Moléculaire sur GPU : la gouttelette (L4–L8) tourne sur WebGPU et correspond au CPU (3 bugs corrigés, pas un problème de précision) | ✅ |
| **P36** | Panneau « État » : forces & modèles actifs | ✅ |
| **P37** | Distribution des vitesses Maxwell-Boltzmann | ✅ |
| **P38** | Atlas HTML interactif des modèles physiques | ✅ |
| **P39** | Approfondissement expert de l'atlas physique | ✅ |
| **P40** | Fondations scientifiques L11 : tenseurs, densité, incertitude | ✅ |
| **P41** | TIP4P/2005 : géométrie rigide et site virtuel exact | ✅ |
| **P42** | Oracle Ewald direct 3D + correction slab | ✅ |

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

## P2 — Moteur GPU (WebGPU/TSL) ✅

**Objectif (DoD) :** moteur GPU + cell-lists ; GPU = CPU à tolérance ; ~50k particules fluides.

**Livré :**
- **Moteur GPU** (`src/engine/gpu/GpuEngine.ts`) : Velocity-Verlet en **3 passes compute TSL**
  (demi-kick → forces → demi-kick), forces **L0/L1 (WCA)** en O(N²) avec image minimale périodique,
  uniforms (dt, masse, boîte, σ²/ε/r_c², périodique), **float32 à ordre de sommation fixe ⇒ reproductible**.
- **Rendu GPU-résident** (`GpuParticleSystem`) : les positions sont lues directement dans le vertex
  shader (`positionNode` + `instanceIndex`) — **zéro readback**, zéro écriture de matrices par frame.
- **Architecture de drivers** (`render/drivers.ts`) : interface `SimDriver` + `CpuDriver`/`GpuDriver`,
  fabrique `createDriver`. `SimulationView` possède le driver actif et se reconstruit au changement
  structurel/de moteur.
- **Refactor du store** : playback (play/substeps) et nonces step/reset dans le store ; `engineKind`
  (CPU/GPU) ; suppression du contrôleur `Simulation` (P1).
- **UI** : bascule **Moteur CPU / GPU** (slider de particules monte à 20k en GPU).
- **Harnais de validation** (`window.__md`) : parité forces/positions GPU↔CPU, dérive d'énergie,
  déterminisme — pour exécution en **navigateur réel**.
- **E2E** : test comportemental GPU (bascule GPU → lecture → le compteur de pas avance, **zéro
  exception** du dispatch compute + rendu GPU). Parité par readback : suite **skip** documentée.

**Vérifications :** lint · typecheck · **28 unit** · **3 e2e** (1 GPU comportemental + 2 app), 4 e2e skip.
Le dispatch compute GPU est confirmé fonctionnel (`compute:ok`) et le pipeline rendu tourne sans erreur.

**Déviations au plan :**
- **Cell-lists reportées** : les forces GPU restent en **O(N²)** (référence). Le voisinage O(N)
  (spatial hash + atomics + prefix sum) est reporté à une passe d'optimisation ultérieure (P3/P7).
  L'O(N²) GPU encaisse déjà plusieurs milliers de particules en temps réel.
- **Validation GPU limitée en CI headless** : Chromium *headless* (a) ne résout pas le readback de
  buffer (`mapAsync`) et (b) ne composite pas le canvas WebGPU dans les captures d'écran. Donc la
  **parité quantitative GPU↔CPU** et le **mouvement de pixels** ne sont validables qu'en **navigateur
  réel** (tests présents mais skip en CI). En CI on valide : compilation+dispatch compute, avancement
  du compteur de pas, absence d'exception. L'oracle **CPU** valide la physique ; les kernels GPU la répliquent.
- **CPU = moteur par défaut** (validé partout). Le GPU est **opt-in** (rendu GPU-résident, gros comptes).
- **Température live en GPU** : re-thermalisation non encore portée sur GPU (no-op ; `Réinitialiser`
  applique). Arrive avec les thermostats en **P5**.

---

## P3 — L2 Lennard-Jones ✅

**Objectif (DoD) :** LJ complet (van der Waals), condensation, pression viriel, g(r).

**Livré :**
- **Force Lennard-Jones 12-6** (`core/forces/lennardJones.ts`) en **force-décalée** (force ET énergie
  continues à r_c = 2.5σ ⇒ bonne conservation NVE), mélange Lorentz-Berthelot. Ajoute la **cohésion**
  manquante à WCA : condensation gaz→liquide, puits de potentiel.
- **g(r)** (`core/observables/rdf.ts`) : fonction de distribution radiale, normalisée par le volume de
  coquille exact.
- **Niveau L2** câblé dans le registre, le moteur **CPU** et le **kernel GPU** (nouveau `kForcesLJ`
  force-décalée, sélection de cutoff WCA/LJ par niveau).
- **UI** : L2 dans le sélecteur ; **graphe g(r) temps réel** (mode CPU) montrant le pic de structure.
- **Tests (+9, total 37)** : LJ vs dérivée numérique, attraction/répulsion, continuité au cutoff,
  puits négatif ; g(r) ≈ 1 pour gaz idéal + pic pour configuration agrégée ; **conservation NVE LJ**
  (<2 %), **cohésion** (PE < 0 à densité liquide).

**Vérifications :** lint · typecheck · **37 unit** · **3 e2e** (4 skip). Tout vert.

**Déviations au plan :**
- **g(r) en UI** : mode **CPU uniquement** (le mode GPU nécessiterait un readback de positions,
  bloqué en headless). Le kernel GPU LJ est validé par dispatch sans erreur (quantitatif en navigateur réel).
- **Cell-lists** toujours reportées (forces O(N²)). Voir P2.

---

## P4 — Démixtion huile/eau (mélange binaire immiscible) ✅

**Objectif (plan) :** L3/L4 — eau & démixtion huile. **Livré : la démixtion huile/eau** (l'effet n°1
demandé) via un modèle d'immiscibilité réel.

**Livré :**
- **Multi-espèces** dans le moteur CPU : composition (fraction de seconde espèce, assignée par seed),
  espèces gros-grain **Eau** et **Huile**.
- **Immiscibilité** : facteur `crossScale` qui atténue l'attraction croisée (ε croisé Lorentz-Berthelot
  × crossScale < 1) ⇒ l'attraction entre semblables domine ⇒ **séparation de phases**.
- **Paramètre d'ordre de démixtion** (`core/observables/demixing.ts`) : fraction moyenne de voisins de
  même espèce (≈ Σf² mélangé → 1 démixé), affiché dans l'UI.
- **Scènes** (`scenes/registry.ts` + `ScenePicker`) : Gaz parfait, Liquide LJ (condensation),
  **Huile + Eau (démixtion)**.
- **Tests (+3, total 40)** : g(r)/démixtion ≈ 0,5 pour mélange aléatoire, ≈ 1 pour clusters séparés ;
  **la démixtion augmente dans le temps** sous attraction croisée réduite (vraie séparation MD).
- **E2E (+1)** : la scène Huile+Eau publie un paramètre de démixtion valide ∈ [0,1].

**Vérifications :** lint · typecheck · **40 unit** · **3 e2e** (4 skip). Tout vert.

**Déviations au plan (importantes) :**
- **Électrostatique atomistique (L3 Coulomb-Wolf)** et **eau rigide SPC/E / TIP4P (L4 : topologie
  moléculaire O+2H, charges partielles, contraintes SETTLE, exclusions)** sont un chantier
  d'architecture lourd, **reporté** faute de budget dans cette passe. La **démixtion huile/eau** — la
  priorité explicite de l'utilisateur — est livrée via un **mélange binaire LJ immiscible** (modèle
  mésoscopique valide, cohérent avec la branche « gros-grain/perf » de la décision hybride).
- Conséquence : pas de liaisons H atomistiques ni d'ions explicites pour l'instant. À reprendre comme
  « L3/L4 atomistique » dans une phase dédiée.
- Multi-espèces : **moteur CPU** (le mode GPU reste mono-espèce ; à étendre avec un buffer de types).

---

## P5 — L5 ensembles : thermostats NVT ✅

**Objectif (plan) :** thermostats + barostats, transitions de phase, contrôle T/P.

**Livré :**
- **Thermostats** (`core/thermostats/`) : **Berendsen** (couplage rapide) et **CSVR/Bussi**
  (rescale stochastique → échantillonnage canonique correct). Orthogonaux aux niveaux de force
  (s'appliquent à L0–L2). Appliqués chaque pas dans le moteur CPU ; RNG dédié à graine (reproductible).
- **Ensemble** sélectionnable dans l'UI : **NVE / Berendsen / CSVR**. Le slider Température devient la
  cible du thermostat (rescale instantané en NVE, cible de bain en NVT).
- **Scènes de transition de phase** : **Cristallisation (NVT)** (refroidissement sous la fusion ⇒ ordre)
  et **Chauffage / gaz (NVT)**.
- **Tests (+4, total 44)** : λ Berendsen (=1 à la cible, chauffe/refroidit du bon côté) ; **Berendsen
  amène un système LJ vers la cible** ; **CSVR maintient T autour de la cible** en moyenne.

**Vérifications :** lint · typecheck · **44 unit** · **4 e2e** (4 skip). Tout vert.
_(Note : les tests physiques lourds peuvent timeouter sous forte charge machine — flaky d'environnement,
verts en isolation et en CI propre.)_

**Déviations au plan :**
- **Barostat (NPT)** non implémenté : reporté (le redimensionnement de boîte + rescale de positions est
  un ajout net ; les thermostats NVT couvrent l'essentiel du contrôle et des transitions de phase).
- **Thermostat GPU** non implémenté (nécessite une réduction d'énergie cinétique sur GPU) : NVT en
  **mode CPU** uniquement ; le mode GPU reste NVE.

---

## P6 — Snapshots, export, sauvegarde de scènes + E2E ✅

**Objectif (plan) :** mode édition, scènes, snapshots/export, suite E2E (variables, états, snapshot).

**Livré :**
- **Schéma Zod** (`state/schema.ts`) pour `SimConfig` et `Snapshot` : validation à l'import.
- **Snapshot d'état complet** (`state/snapshot.ts`) : config + positions/vitesses/types sérialisés ;
  `captureSnapshot`/`restoreSnapshot` + `CpuEngine.loadState`. **Round-trip via JSON** restauré à
  l'identique (reproductibilité bit-à-bit après restauration).
- **Export / import** (`ui/export/`) : **config JSON** (= sauvegarde/chargement de scène, l'« édition »
  pratique, Zod-validée), **snapshot JSON** (état complet), **g(r) CSV**. Référence au driver actif pour
  lire l'état de façon synchrone.
- **Robustesse tests** : `testTimeout` global 30 s (les tests physiques O(N²) parallèles ne timeoutent
  plus sous charge).
- **Tests (+5, total 49)** : round-trip snapshot (restaurer → continuer = identique) ; schéma Zod
  accepte le valide, rejette enum/plage/champs manquants.
- **E2E (+1, total 5)** : l'export de config déclenche bien un téléchargement `scene-config.json`.

**Vérifications :** lint · typecheck · **49 unit** · **5 e2e** (4 skip). Tout vert.

**Déviations au plan :**
- **Éditeur 3D interactif** (placer/peindre molécules, dessiner des régions) **reporté** : l'édition est
  faite par **config de scène** (sliders + espèces + composition + export/import JSON), qui round-trippe
  une scène complète. L'éditeur de placement à la souris est une surcouche future.
- **Export PNG** non inclus (la capture du canvas WebGPU est peu fiable en headless ; à faire en
  navigateur réel). Export de **données** (JSON/CSV) fourni à la place.
- Snapshot/export d'**état** en **mode CPU** (l'état GPU nécessiterait un readback bloqué en headless).
  L'export de **config** marche dans les deux modes.

---

## P7 — Performance : neighbor search O(N) par cell-lists ✅

**Objectif (plan) :** mode gros-grain (perf), très grand N, passe d'optimisation.

**Livré :**
- **Cell-lists (linked-cell) O(N)** pour la force Lennard-Jones (`forces/lennardJonesCell.ts`) :
  grille de cellules ≥ cutoff, listes chaînées tête/suivant, parcours des 27 cellules voisines (PBC),
  chaque paire comptée une fois. **Physique identique** à la référence O(N²) ; repli brute si la boîte
  est trop petite (< 3 cellules/axe).
- Le **moteur CPU L2** utilise désormais la cell-list ⇒ grands comptes de particules praticables en
  temps réel (l'algorithme « best practice » du plan).
- **Tests (+3, total 52)** : la cell-list **égale la référence O(N²)** (forces à < 1e-6, énergie/viriel)
  pour un liquide mono-espèce, un **mélange binaire** (crossScale), et le **chemin de repli** (petite boîte).

**Vérifications :** lint · typecheck · **52 unit** · **5 e2e** (4 skip). Tout vert.

**Déviations au plan :**
- **Gros-grain MARTINI/DPD** complet **reporté** : l'optimisation livrée est le **cell-list O(N)**
  (le vrai goulot d'étranglement algorithmique), validable et exact. Les billes gros-grain Eau/Huile
  (P4) couvrent déjà l'aspect « mésoscopique ».
- **Cell-lists GPU** (spatial hash + atomics + prefix sum) **reportées** : le chemin GPU reste O(N²)
  (validation headless limitée). Le cell-list CPU est l'optimisation exacte et testée de cette passe.

---

## P8 — Polish ✅

**Objectif (plan) :** rendu de surface de fluide, éclairage, post-FX, accessibilité, docs, tutoriels.

**Livré :**
- **Visualisation par vitesse** : carte thermique des particules (bleu lent → rouge rapide), sélecteur
  Couleur **Espèce / Vitesse** (l'effet « voir le chaud/froid » et la diffusion).
- **Raccourcis clavier** : `Espace` lecture/pause, `R` réinitialiser, `N` un pas.
- **Plafond CPU relevé** à 4000 particules (rendu possible par les cell-lists O(N)).
- **README** complet : niveaux, ensembles, moteurs, scènes, observables, export, validation, archi.

**Vérifications :** lint · typecheck · **52 unit** · **5 e2e** (4 skip). Tout vert.

**Déviations au plan :**
- **Rendu de surface de fluide (raymarching/metaballs) et post-FX** reportés : le rendu reste des
  **sphères instanciées** (lisibles, performantes) + carte de vitesse. Le rendu de surface est un
  chantier graphique distinct.
- La **carte de vitesse** est en **mode CPU** (le GPU garde la couleur par espèce ; un `colorNode`
  lisant le buffer de vitesses serait l'évolution GPU).

---

## P9 — L3 électrostatique atomistique (Coulomb-Wolf) ✅

**Comble une déviation P4.** Vraie électrostatique, sans FFT, adaptée au navigateur.

**Livré :**
- **`erfc`** (approximation Numerical Recipes) + constante de Coulomb (138.935 kJ·mol⁻¹·nm·e⁻²).
- **`IonicForce` (L3)** : Lennard-Jones + **Coulomb Wolf damped-shifted-force (DSF)** dans une passe ;
  force ET énergie continues au cutoff Coulomb ; charges depuis la table d'espèces.
- **Ions Na⁺ / Cl⁻**, niveau **L3** (registre + moteur CPU + schéma Zod), **scène NaCl ionique** (NVT)
  où les ions opposés s'attirent et s'ordonnent.
- **Tests (+4, total 56)** : Coulomb vs dérivée numérique, attraction/répulsion, continuité au cutoff,
  pas de Coulomb si partenaire neutre.

**Déviations restantes :** électrostatique **GPU** non implémentée (L3 sur GPU = LJ seul, sans Coulomb).

---

## P10 — L4 eau atomistique (SPC/Fw) ✅

**Comble la déviation majeure : « vraie eau H₂O ».**

**Livré :**
- **Topologie moléculaire** : `moleculeId` par atome (exclusions intramoléculaires), liaisons et angles.
- **`WaterForce` (L4)** : non-liée (LJ O–O + Coulomb Wolf, **exclusion intramoléculaire**) + **liaisons
  O–H harmoniques** + **angles H–O–H harmoniques**, le tout en **image minimale** (le wrapping PBC
  par atome ne casse jamais une molécule).
- **Constructeur de boîte d'eau** : molécules O+2H placées sur réseau, géométrie SPC/Fw exacte,
  orientation aléatoire ; vitesses Maxwell-Boltzmann.
- **Niveau L4** (registre + moteur CPU + Zod) + **scène « Eau atomistique »** (NVT Berendsen, dt 0.5 fs).
- **Tests (+3, total 59)** : force liaison et **force d'angle vs gradient numérique** ; **stabilité du
  système d'eau** (pas de NaN, longueurs O–H ≈ r₀ ⇒ molécules intactes, T proche de la cible).
- **E2E (+1, total 6)** : la scène eau atomistique tourne sans exception.

**Déviations restantes :**
- **Eau flexible** (liaisons/angles harmoniques raides) plutôt que **rigide** (contraintes SETTLE/RATTLE) :
  plus simple, physiquement valide, mais nécessite un petit pas de temps (~0.5 fs). SETTLE = amélioration future.
- Eau/électrostatique **sur GPU** non portées (CPU uniquement) ; **barostat NPT**, **cell-lists GPU** et
  **rendu de surface de fluide** restent reportés.

---

## P11 — Barostat NPT (Berendsen) ✅

**Complète le trio d'ensembles NVE / NVT / NPT.**

**Livré :**
- **Barostat Berendsen** dans le moteur CPU : calcule la pression viriel, redimensionne la cellule +
  les positions par μ = ∛(1 + (Δt/τ_P)·β·(P − P_cible)) à chaque pas (clamp doux pour la stabilité).
- Config `barostat` + `pressureTarget` (bar) (+ Zod), **redimensionnement live du fil-de-fer de la
  boîte** dans le rendu, sélecteur **Volume fixe / NPT** + slider de pression cible dans l'UI.
- **Tests (+2, total 61)** : un liquide sur-pressurisé se **dilate** vers la cible (volume ↑, P ↓) ;
  boîte **fixe** quand le barostat est off.

**Déviations restantes (extensions futures) :** barostat **GPU** non porté (CPU only). NPT couvre la
densité/pression ; les ensembles NVE/NVT/NPT sont tous disponibles.

---

## P12 — Gravité ✅ (Plan v2)

- Accélération uniforme −y (réglable, exagérée vs g réel pour la visibilité) dans le Velocity-Verlet,
  **CPU et GPU** (uniform `uGravity` dans les kernels d'intégration). Indépendante de la masse.
- Config `gravity`, setters live (CPU+GPU), slider UI, **scène « Sédimentation »** (gravité + parois).
- **Tests (+2, total 63)** : sous gravité le centre de masse **descend** ; gravité nulle ⇒ COM immobile.

---

## P13 — Eau rigide L5 (SHAKE/RATTLE) ✅ (Plan v2)

- **Solveur de contraintes** (`core/constraints.ts`) : **SHAKE** (positions, projetées le long des liaisons
  de référence, corrections reportées dans les vitesses) + **RATTLE** (vitesses ⊥ aux liaisons) — l'effet
  de SETTLE pour l'eau 3-sites.
- **Niveau L5 — eau rigide** : 3 contraintes/molécule (2× O–H + H–H), WaterForce en mode rigide
  (non-liée seule), intégrateur contraint dans le moteur, **pas de temps 2 fs** (vs 0.5 fs flexible).
- Scène « Eau rigide ».
- **Tests (+1, total 64)** : distances O–H et H–H **exactement maintenues** (< 1e-4 nm) sur 2000 pas à
  2 fs, T saine, pas de NaN.

**Déviation comblée :** l'eau rigide à contraintes (SETTLE/RATTLE) demandée est livrée.

---

## P14 — Polish visuel ✅ (Plan v2)

- **Tone mapping ACES Filmic** + exposition ; **lumière hémisphérique** ciel/sol + key/fill ⇒ rendu plus
  volumétrique et « AAA ». Matériau des sphères affiné (roughness/metalness).
- Tests/E2E inchangés (64 + 6, verts) ; aucun risque physique (purement rendu).

**Note sur le « rendu de surface de fluide » et les portages GPU (non livrés, justifié) :**
- Une vraie **surface de fluide raymarchée** (metaballs écran-espace : depth → épaisseur → flou bilatéral →
  normales → éclairage) est un sous-projet graphique à plusieurs cibles de rendu, **non validable en
  headless** (capture canvas bloquée). Livré à la place : sphères instanciées + carte de vitesse + ACES.
- **Portage GPU** de Coulomb/eau/cell-lists/thermostat : nécessite atomics/prefix-sum/réductions en TSL
  **non validables quantitativement en headless** (readback `mapAsync` bloqué). Écrire ces kernels sans
  pouvoir vérifier leur exactitude introduirait un risque de régression — contraire à « parfait ». Le
  chemin GPU actuel (LJ/WCA O(N²) + gravité + périodique, rendu GPU-résident) reste l'accélérateur grand-N ;
  la parité quantitative se valide en **navigateur réel** via `window.__md`.

---

## P15 — GPU cell-lists O(N) + thermostat GPU ✅ (Plan v2)

**Comble la déviation « portage GPU » (recherche de voisins O(N) + NVT sur GPU).**

**Livré (TSL compute) :**
- **Cell-lists GPU** par hachage spatial à **bins de capacité fixe + atomiques** (sans prefix-sum) :
  `kClearCells` (`atomicStore`), `kBinParticles` (`atomicAdd` → slot dans le bin), `kForcesCellWCA/LJ`
  (parcours des 27 cellules voisines avec image minimale, `atomicLoad` du compteur). Grille dimensionnée
  pour le cutoff le plus fin ; bascule auto sur le brute O(N²) si < 3 cellules/axe.
- **Thermostat Berendsen GPU** : `kThermostat` scale les vitesses par λ (uniforme), λ recalculé depuis la
  KE du readback dans `observables()` (actif en navigateur réel ; no-op inoffensif en headless).
- Câblé : `forcePassNodes()` choisit cell-list vs brute ; `stepNodes()` ajoute le thermostat ; setLevel/
  setGravity/setThermostat live.

**Validation :** typecheck strict + **E2E headless qui dispatche réellement** les kernels cell-list (WCA
*et* LJ) + thermostat sans erreur de compilation WGSL / atomics. La **parité numérique GPU↔CPU** se vérifie
en **navigateur réel** (`window.__md`) — le readback `mapAsync` ne résout pas en headless.

**Hors-scope assumé :** Coulomb/eau **sur GPU** restent non portés car le GPU est **mono-espèce** (charge/σ/ε
uniques) ⇒ l'électrostatique y serait non physique ; cela demanderait d'abord un GPU multi-espèces.

---

## P16 — Rendu de surface de fluide (écran-espace) ✅ (Plan v2)

**Comble la déviation « rendu de surface de fluide ».**

- **`FluidRenderer`** — pipeline **3 passes** : (1) scène dans une cible offscreen ; (2) **champ de
  densité metaball** (particules rendues en dômes additifs face-caméra → les voisines fusionnent) dans
  une 2ᵉ cible HalfFloat (lignes/wireframe masquées) ; (3) **composite plein écran** (`QuadMesh`) qui
  reconstruit une normale depuis le gradient écran-espace du champ et ombre une **surface d'eau
  translucide** (diffus + rebord de Fresnel) là où le champ dépasse un seuil.
- Bascule UI **Sphères / Fluide** (réglage de vue, défaut Sphères). Actif sur le rendu CPU instancié ;
  le GPU garde ses sphères résidentes (son nœud de position vertex ne peut être remplacé par l'override).
- **Validation :** typecheck + **E2E headless** qui exécute réellement les 3 passes (RenderTargets +
  `overrideMaterial` + `QuadMesh`) sans exception. **Le rendu visuel se vérifie en navigateur réel**
  (le canvas WebGPU n'est pas composé dans les captures headless).

---

## P17 — Réalisme, démixtion huile/eau, corrections physiques + GPU ✅ (retour utilisateur)

**Déclencheur :** « aucun preset ne fonctionne, je veux voir les 2 phases se former, rends les vraies
molécules, scientifiquement hyper correct + es-tu sûr du GPU ? » → mise en place d'une **boucle de
vérification visuelle** (Playwright **headed** = le canvas WebGPU est composé ; le headless ne l'est pas).

**Diagnostiqué visuellement :** le rendu marchait (les captures headless noires étaient un artefact de
compositing), mais : molécules non rendues comme molécules (pas de liaisons) ; huile/eau ne démixe pas ;
**NaCl explosait à 1849 K** ; **eau L4 à 503 K** ; **le GPU explosait** (T ≈ 1e40 K).

**Corrigé :**
- **Vraies molécules à l'écran** : `BondSystem` (cylindres instanciés par liaison, image-minimale) +
  rendu **ball-and-stick** (atomes réduits) ⇒ l'eau se lit comme H₂O coudé, l'huile comme une chaîne C–C–C.
- **NaCl** : placement **rock-salt alterné** (charges opposées voisines) ⇒ cristal stable **277 K** (vs 1849).
- **Eau L4** : thermostat **CSVR** ⇒ ~340 K (vs 503).
- **NOUVEAU L6 — mélange atomistique huile/eau** : `MolecularForce` (champ de forces général : LJ
  Lorentz-Berthelot + Coulomb Wolf + exclusions intramoléculaires + liaisons/angles harmoniques par
  élément) + `buildOilWaterSystem` (**eau SPC rigide SHAKE + huile alcane TraPPE flexible**, départ mélangé,
  **colonne haute** + **gravité**). **Démixtion hydrophobe réelle** : l'eau (dense) coule **sous** l'huile
  (légère) — vérifié **numériquement** (water_y < oil_y) **et visuellement**.
- **GPU honnête** : la parité headed a montré que le **cell-list GPU était faux** (explosion). Désactivé ⇒
  retour au kernel **brute O(N²) éprouvé** ; le GPU est de nouveau **stable** (T ≈ CPU). Le cell-list GPU
  reste dans le code mais gaté off (à corriger/valider en navigateur réel).

**Tests :** +2 (gradient liaison/angle de `MolecularForce`, sanity du builder) ⇒ **66 unitaires + 7 e2e**.
Diagnostic « aucun preset n'explose » exécuté pour les 9 scènes (toutes finies).

---

## P18–P21 — Phénomènes, performance, GPU multi-espèces (retour utilisateur) ✅

**Déclencheur :** « pousse le nombre de molécules, corrige le cell-list GPU, tension de surface,
dissolution d'un cristal, plein de phénomènes, MD parfaitement correcte. »

- **P18 — Tension de surface (L7)** : `buildWaterSystem` peut empaqueter un agrégat centré (vide
  autour) ⇒ la cohésion (liaisons H) sphérifie l'eau. **Perf** : `core/neighbors.ts`
  `forEachNeighborPair` (cell-list O(N), repli brute) ; `WaterForce` et `MolecularForce` l'utilisent
  pour le non-lié ⇒ la colonne huile/eau passe de quelques FPS à ~66 FPS, **nombre de molécules
  poussé** (huile/eau 120→320). **GPU honnête** : `gpuSupportsConfig` + repli CPU + bascule GPU
  grisée là où non supporté.
- **P19 — GPU multi-espèces + Coulomb** : paramètres par atome (σ, ε, charge, 1/m) en vec4 ; LJ
  Lorentz-Berthelot + **Coulomb Wolf DSF** (erfc approximé en TSL) ; intégrateurs et KE par atome ;
  **rendu par espèce** (Na⁺/Cl⁻ distincts). Vérifié en navigateur réel : GPU NaCl ~300–310 K stable.
  La GPU couvre maintenant **L0–L3** (ions, mélanges) ; L4–L8 (liaisons/contraintes) restent CPU.
- **P20 — Dissolution (L8)** : cristal de NaCl rock-salt neutralisé plongé dans l'eau SPC
  (`core/dissolution.ts`) ; l'eau polaire solvate les ions de surface, le cristal se dissout.
- **P21 — Cell-list GPU** : diagnostic en navigateur réel — **binning correct** (somme des comptes
  = N), mais le kernel de **parcours de cellules** produit des forces fantômes ⇒ **gardé désactivé**,
  le kernel **brute O(N²)** (correct, parallèle, gère des milliers d'atomes) reste le chemin GPU.

**Phénomènes visibles** (11 scènes, 0 erreur) : gaz parfait, liquide LJ, **démixtion huile/eau +
gravité**, cristallisation, eau atomistique H₂O, eau rigide, **tension de surface (gouttelette)**,
cristal NaCl (CPU + GPU), **dissolution d'un cristal de sel**, sédimentation, ébullition.

---

## P23–P25 — « On ne voit pas les effets » : rendre chaque preset lisible (retour utilisateur) ✅

**Déclencheur :** « rends chaque preset bien meilleur, je ne vois presque plus les effets désirés…
améliore le moteur physique. » Les scènes monoatomiques remplissaient la boîte uniformément (un
blob figé) au lieu de montrer une **transition**.

- **P23 — moteur : `initialTemperature` ≠ cible + `initialClump`.** Les vitesses partent à
  `initialTemperature`, le thermostat tire vers `temperature` ⇒ on **voit** la transition.
  `initialClump` place les atomes monoatomiques en gouttelette centrée (densité liquide). Scènes
  refondues : **Liquide** (gouttelette cohésive + surface + vapeur), **Cristallisation**
  (liquide → solide, recuit lent), **Ébullition** (gouttelette froide chauffée ⇒ s'évapore).
  Sphères monoatomiques réduites (0.78×) pour voir surfaces et structure.
- **P24 — bug réel : blow-up des cristaux serrés.** Dans une boîte < 2·(2.5σ), le cutoff **LJ**
  dépassait L/2 ⇒ un atome interagissait avec un voisin ET son image périodique (force
  double-comptée ⇒ explosion lente : NaCl atteignait ~1e62 K). Tous les modèles de force (ionic,
  water, molecular) **plafonnent désormais chaque cutoff** (LJ + grille du cell-list) à l'image
  minimale, comme le faisait déjà Coulomb. Test de non-régression ajouté. **Mode couleur
  « Structure »** (coordination locale : cœurs denses/ordonnés en chaud, surfaces/gaz en froid) +
  **couleur auto par scène** (Gaz → vitesse ; Liquide/Cristal/Sédiment/Ébullition → Structure) ⇒
  l'effet se lit immédiatement.
- **P25 — bug réel : fuite de config entre scènes.** Le store charge une scène par **fusion**
  (`{...prev, ...scene}`) ; comme `make()` omettait `initialClump`/`initialTemperature`, le flag
  `initialClump:true` de **Liquide/Ébullition** **persistait** jusqu'à **NaCl**, dont les 216 ions
  se retrouvaient empaquetés dans un amas plus gros que la boîte ⇒ explosion. `make()` réinitialise
  maintenant ces champs. Tests de non-régression ajoutés. **Montage complet 11 scènes : tout stable.**

**69 tests unitaires + 7 e2e.** Chaque preset montre clairement son phénomène, sans erreur.

---

## P26–P28 — Toutes les scènes (ou presque) sur GPU + bien plus de molécules (retour utilisateur) ✅

**Déclencheur :** « accepte plus de molécules en faisant tourner chaque preset sur WebGPU ; base-toi
sur la vraie recherche, utilise des agents. » Avant : le GPU ne faisait que le monoatomique L0–L3.

Recherche (agents) → patterns de production (OpenMM/GROMACS) : forces liées par kernel par
liaison/angle, **pas d'atomics f32 en WebGPU** ⇒ accumulateur **i32 point-fixe** (atomicAdd), eau
rigide par **SETTLE/SHAKE** (par molécule, parallèle), exclusions par moleculeId.

- **`src/engine/buildSystem.ts`** : un constructeur de système unique et déterministe (état +
  espèces + topologie plate liaisons/angles/contraintes) ⇒ le GPU bâtit les systèmes moléculaires
  exactement comme le CPU (test de non-régression : lock-step CPU/GPU sur L1/L3/L4/L5/L8).
- **P26 (L4)** : forces liées (liaisons + angles) scatterées dans un accumulateur i32 (FORCE_SCALE
  2¹⁴) puis déquantifiées ; non-lié LJ+Coulomb avec exclusions intramoléculaires (moleculeId).
  GPU eau atomistique ~270–300 K, 120 FPS, molécules intactes.
- **P27 (L5/L7/L8)** : eau rigide par **SHAKE/RATTLE par molécule** — un thread possède les 3 atomes
  d'une molécule ⇒ itérations sans course (sans atomics), réutilise l'algo CPU validé. GPU eau
  rigide 300,5 K (exactement la cible ⇒ contraintes correctes).
- **P28** : **parois réfléchissantes** dans l'intégrateur (miroir + inversion de la vitesse normale)
  ⇒ sédimentation et le reste sur GPU. `gpuSupportsConfig` couvre **tout sauf L6** (huile/eau :
  parois + boîte non-cubique + molécules mixtes ⇒ transitoires que le thermostat GPU sur-corrige).

**Plus de molécules** : vérifié headed — **900 molécules d'eau (2700 atomes) à 95 FPS** sur GPU
(le CPU fait ~125 à 28 FPS). **Audit : 10/11 scènes sur GPU à 120 FPS, L6 en repli CPU, 0 erreur.**

## P30–P31 — Cell-list GPU O(N) RÉPARÉ ⇒ vraie montée en échelle ✅

Le cell-list à capacité fixe produisait des paires fantômes et était désactivé depuis ~3 sessions.
**Réécrit façon production** (LAMMPS/HOOMD, tri par comptage) ⇒ le mode de défaillance devient
structurellement impossible : `clear → comptage par cellule (atomic) → somme préfixe exclusive
(cellStart) → dispersion dans un tableau trié → parcours du pochoir 27-cellules` (boucle dynamique
par cellule, **sans capacité fixe**). Maths de paires identiques au brute (mêmes T). **P31** : variante
avec **exclusions intramoléculaires** pour le moléculaire ; grille dimensionnée au max(2.5·σmax,
cutoff Coulomb). Activé en périodique avec ≥3 cellules/axe, sinon repli brute.

**Échelle vérifiée headed** : monoatomique **16 000 atomes à 87 FPS** (T=90 K), eau moléculaire
**12 000 atomes / 4000 molécules à 120 FPS** — le brute plafonnait vers ~3-5k. Aucune régression.
**74 tests unitaires + 7 e2e.**

## P32 — « Le GPU doit donner le MÊME résultat que le CPU » (retour utilisateur) ✅

**Déclencheur :** sur GPU la gouttelette d'eau ne se forme pas, les molécules tournent trop vite et
sortent de la boîte ; pareil pour les presets moléculaires. Diagnostic rigoureux (lecture headed +
comparaison force par force CPU↔GPU **aux positions identiques**) :
- Les **forces GPU sont correctes** : elles correspondent au CPU à la précision float32 (écart max
  ~0,05 sur des forces ~2000) pour l'eau flexible (L4) et rigide (L5) — LJ + Coulomb Wolf-DSF +
  liaisons/angles + exclusions intramoléculaires.
- MAIS le velocity-Verlet **float32 ne conserve pas l'énergie** comme le float64 du CPU pour ces
  systèmes raides, à atomes légers (H) et à fort Coulomb : en NVE l'eau GPU monte à ~2000 K vs ~550 K
  au CPU (indépendant du pas de temps, non corrigé par plus d'itérations SHAKE) ⇒ limite de
  précision, pas un bug des forces. L'eau trop chaude ne se condense jamais en gouttelette.

**Décision (correction > couverture)** : `gpuSupportsConfig` n'autorise QUE le monoatomique L0–L3
(où le GPU est **vérifié identique au CPU** : lj 90 K, NaCl ~300 K, cristal 35 K). Les niveaux
moléculaires (L4–L8) repassent sur **CPU** (corrects, forment des gouttelettes). « Chaque calcul GPU
== CPU » est donc vrai. Les kernels moléculaires GPU restent dans le code (forces correctes) pour un
futur intégrateur en précision mixte. **74 tests + 7 e2e.**

---

## P33 / P34 — Nouvelles forces : champ électrique, Langevin, dièdres, Morse ✅

Demande : « implémente 1-2-3-4 en y incluant les démos (CPU et GPU), best quality, AAA » — les 4
forces proposées précédemment.

**P33 (champ électrique + Langevin, CPU + GPU)** :
1. **Champ électrique** `F = q·E` (+x, dépend de la charge), ajouté dans le kick velocity-Verlet
   (CPU : VV + chemin rigide SHAKE ; GPU : kernels de kick) + slider live « Champ électrique ».
   Démo **Électrophorèse** : Na⁺/Cl⁻ migrent vers des parois opposées.
2. **Thermostat de Langevin** (friction + bruit par atome, étape « O » de BAOAB) : vraie NVT QUI
   produit aussi le **mouvement brownien**. CPU = gaussienne mulberry32 ; GPU = **hash PCG entier**
   de (atome, pas, composante) — variance exacte 1/12 vérifiée hors-ligne (le `hash` TSL intégré est
   du bruit lisse → coups cohérents → faux). Démo **Mouvement brownien**. Le Langevin sert aussi à
   l'électrophorèse (vitesse de dérive terminale = mobilité ; dissipe le travail aux parois ⇒ stable
   sur GPU là où un Berendsen retardé surchaufferait). Brownien CPU = 300 K exact, GPU ≈ 225 K (perte
   d'intégration float32 que le thermostat stochastique équilibre — le MOUVEMENT est correct).

**P34 (dièdres + Morse, CPU — moléculaire)** :
3. **Dièdres** i–j–k–l, potentiel Ryckaert-Bellemans `V(φ)=Σ cₙ cosⁿφ`, gradient GROMACS conservant
   la quantité de mouvement. Niveau **L9 « Alcane (dièdres) »** : chaînes d'alcane united-atom qui
   basculent trans/gauche et se replient.
4. **Liaisons de Morse** `V=Dₑ(1−e^(−a·dr))²`, `Dₑ=k/(2a²)` : la force s'annule à r→∞ ⇒ la liaison
   se ROMPT (impossible avec un ressort harmonique). Niveau **L10 « Dissociation »** : diatomiques à
   puits peu profond (~25 kJ/mol) chauffées à 1000–1200 K ⇒ les liaisons cassent.

Chaque force est **vérifiée contre le gradient numérique de l'énergie** (chaque coordonnée) +
conservation de la quantité de mouvement + comportements physiques (trans<cis, profondeur Dₑ,
dissociation). **89 tests unitaires (+15) + 7 e2e.** GPU gardé identique au CPU (monoatomique) ;
dièdres/Morse sont moléculaires donc CPU. Commits P33 `1ac83f7`, P34 `4b5a0f7`.

---

## P35 — Moléculaire sur GPU : la gouttelette d'eau (retour utilisateur « le bouton GPU est grisé ») ✅

L'utilisateur demande un **intégrateur en précision mixte** pour que la gouttelette tourne sur GPU.
Diagnostic : **ce n'était PAS un problème de float32**. Une comparaison **un pas** GPU↔CPU depuis un
état identique divergeait de 0,0014 nm / 1,44 nm·ps⁻¹ (1000× le plancher float32 ⇒ pas de la
précision) et une lecture propre des forces montrait le GPU calculant **zéro force** pour la
gouttelette. **Trois vrais bugs**, tous corrigés :
1. **Coulomb désactivé** pour le moléculaire (`useCoulomb = level === "L3"` ⇒ eau sans liaisons H ⇒
   aucune cohésion). → `=== "L3" || molecular`.
2. Le **kernel cell-list moléculaire** perdait tous les voisins ⇒ zéro force (la gouttelette L7
   boîte 3,2 emprunte le chemin cell-list ; L5 boîte 1,7 = brute, d'où l'illusion que L5 marchait).
   → le moléculaire utilise toujours le chemin **brute O(N²)** (systèmes petits, vérifié).
3. **SHAKE/RATTLE sous-convergés** à 6/4 itérations (la contrainte H–H couplée de l'eau converge
   lentement) ⇒ travail net des contraintes ⇒ injection d'énergie (L5 NVE ~1750 K). → **50/30**
   itérations ⇒ L5 NVE ~338 K (CPU ~550), énergie conservée.

Résultat : la gouttelette GPU **se sphérifie** depuis le départ froid, la dissolution solvate, et T
suit le CPU à ~10 % près (L4–L8). `gpuSupportsConfig` autorise désormais L0–L8 ; L9/L10
(dièdres/Morse) restent CPU (pas de kernels GPU). **89 tests + 7 e2e.** Commit P35 `f80773c`.
**Leçon** : quand le GPU « chauffe / ne cohère pas », diffère UN pas contre le CPU et lis les forces
AVANT d'accuser la précision.

---

## P36 — Panneau « État » : forces & modèles actifs ✅

**Objectif (DoD) :** l'utilisateur veut voir, pour chaque niveau de physique, quelles forces et
quels modèles tournent — directement dans le panneau « État ».

**Livré :** chaque entrée d'`ACCURACY_LEVELS` (`engine/types.ts`) porte désormais une liste
`forces` (les termes réellement calculés à ce niveau : WCA, LJ force-décalée, Coulomb Wolf DSF,
liaisons/angles harmoniques, SHAKE/RATTLE, dièdres RB, Morse…). `ObservablesPanel` affiche sous les
métriques un bloc « Physique · <niveau> » en puces (`data-testid="physics-forces"`), complété par
les termes **dépendant de la config courante** : gravité, champ électrique, thermostat
(Berendsen/CSVR/Langevin), barostat NPT.

**Vérifications :** lint + typecheck + 89 tests + 7 e2e verts ; captures en navigateur réel (headed)
sur L1, L7 (chips eau rigide + SHAKE + thermostat Berendsen) et L9 (chips dièdres RB + CSVR).

**Déviations au plan :** aucune (hors plan — demande utilisateur directe).

---

## P37 — Distribution des vitesses (Maxwell-Boltzmann) dans « Mesures en temps réel » ✅

**Objectif (DoD) :** l'utilisateur veut un graphe temps réel de la distribution des vitesses des
molécules dans le panneau « Mesures en temps réel ».

**Livré :**
- `core/observables/speedDistribution.ts` : histogramme de |v| normalisé en densité de probabilité
  + la prédiction **Maxwell-Boltzmann exacte** à la T cinétique courante, **pondérée par espèce**
  pour les mélanges (l'eau donne la forme bimodale O + queue H). Axe = 3× la vitesse la plus
  probable de l'espèce la plus légère. 3 tests unitaires (histogramme ≈ analytique sur des vitesses
  MB échantillonnées, ⟨|v|⟩ = √(8kT/πm), mélange pondéré, état vide).
- `SimDriver.speedDistribution()` : CPU calcule (48 bins), GPU rend `null` (vitesses résidentes
  device — même contrat que g(r)/démixtion). Publié via `publishAnalysis` (cadence 500 ms).
- `HistogramChart` (canvas, sans dépendance) : barres mesurées + courbe analytique en surimpression,
  légende « Mesurée / Maxwell-Boltzmann (T courante) », readout ⟨|v|⟩.

**Vérifications :** lint + typecheck + **92 tests** + 7 e2e verts ; captures headed : argon L1 colle
à la courbe MB (⟨|v|⟩ 0,39 nm/ps à 290 K = √(8kT/πm) ✓), gouttelette L7 bimodale (O lent + H rapide)
suivie par la courbe pondérée.

**Déviations au plan :** aucune (hors plan — demande utilisateur directe).

---

## P38 — Atlas HTML interactif des modèles physiques ✅

**Objectif (DoD) :** documenter visuellement et sans approximation marketing chaque modèle de
physique de l'application, son calcul, sa vulgarisation, sa précision vérifiée et ses limites.

**Livré :** `doc/index.html`, page autonome responsive en français : échelle complète L0→L10,
Velocity-Verlet, unités GROMACS, CPU/GPU, thermostats, barostat, gravité, champ électrique,
frontières et observables. Laboratoires interactifs pour WCA/LJ/Coulomb/Morse et
Maxwell-Boltzmann, formules KaTeX, navigation/recherche, thèmes clair/sombre et accessibilité.
Toutes les valeurs et affirmations quantitatives proviennent des constantes, algorithmes et tests
du dépôt ; les notes de fidélité subjectives ont été explicitement écartées.

**Vérifications :** audit croisé avec `core/`, `engine/`, `scenes/` et les tests ; Biome ; rendu
réel desktop 1280 px et mobile 390 px (aucun débordement), 11 cartes, 37 formules KaTeX, deux
canvas haute densité, contrôles interactifs et zéro erreur JavaScript.

**Déviations au plan :** aucune (hors plan — demande utilisateur directe).

---

## P39 — Approfondissement expert de l'atlas physique ✅

**Objectif (DoD) :** expliquer chaque modèle beaucoup plus en détail sans dégrader la lecture
grand public ni transformer la page en mur de texte.

**Livré :** une couche expert repliable pour chacun des 11 niveaux L0→L10 avec : déroulé exact de
l'algorithme, constantes réellement utilisées, preuves issues des tests et interprétations à ne pas
faire. Ajout d'une dérivation complète de Velocity-Verlet (quatre opérations, ordre, caractère
symplectique, critère de pas de temps) et d'un comparatif technique CPU↔GPU (Float64/Float32,
cell-lists, accumulateur i32 quantifié, SHAKE/RATTLE, chemins de repli).

**Vérifications :** 13 panneaux d'approfondissement, 44 formules KaTeX, contrôle d'ouverture au
clavier/souris, rendu desktop 1280 px et mobile 390 px sans débordement, zéro avertissement ou
erreur navigateur ; lint/typecheck/tests/build/e2e verts.

**Déviations au plan :** aucune (hors plan — demande utilisateur directe).

---

## P40 — Fondations scientifiques L11 : tenseurs, densité, incertitude ✅

**Objectif (DoD) :** démarrer l'expérience quantitative TIP4P/2005 par des primitives de mesure
testées, avant d'ajouter un nouveau champ de force ou une UI qui pourrait donner une fausse
impression de précision.

**Livré :** contrat scientifique complet dans `docs/EXPERIMENT-L11.md` (géométrie, modèle,
références primaires, protocole, critères d'acceptation et ordre d'implémentation). Nouvelles
observables pures : tenseur cinétique symétrique, tenseur de pression à partir du viriel,
γ mécanique d'un slab à deux interfaces, conversion exacte kJ·mol⁻¹·nm⁻² → mN·m⁻¹, moyennes par
blocs avec erreur standard, et profil de densité massique ρ(z) avec conservation de la masse.

**Vérifications :** lint + typecheck + **99 tests** (29 fichiers) + build + **7 e2e** verts. Les
7 nouveaux tests couvrent chaque composante tensorielle, la formule de γ, la conversion d'unités,
les blocs incomplets, les entrées invalides, le wrapping z et l'intégrale du profil de masse.

**Déviations au plan :** L11 reste volontairement CPU-only tant que l'oracle TIP4P/2005/Ewald
n'existe pas et que sa parité n'est pas démontrée.

---

## P41 — TIP4P/2005 : géométrie rigide et site virtuel exact ✅

**Objectif (DoD) :** implémenter le modèle moléculaire cible sans exposer prématurément une scène
périodique utilisant une électrostatique tronquée.

**Livré :** constantes TIP4P/2005 de la publication originale, builder déterministe à orientations
uniformes SO(3), géométrie rigide O–H/H–H, espèces O/H massives et site négatif M sans masse. Le site
M est une combinaison affine de O/H ; la redistribution de sa force utilise la transposée exacte du
Jacobien et conserve donc force et couple. Un oracle de dimère isolé calcule LJ O–O complet +
Coulomb direct H/H/M. Il refuse explicitement les boîtes périodiques : L11 attend Ewald.

**Vérifications :** lint + typecheck + **103 tests** (30 fichiers) + build + **7 e2e** verts.
Nouveaux tests : géométrie à 12 décimales, neutralité, impulsion initiale, distance OM, conservation
force/couple à 15 décimales, gradient numérique sur les 18 coordonnées avec erreur relative
< 2×10⁻⁷, conservation de la force totale et garde-fou périodique.

**Déviations au plan :** aucune. Le modèle n'est volontairement pas ajouté à `SimConfig`/UI avant
la livraison de l'oracle Ewald périodique.

---

## P42 — Oracle Ewald direct 3D + correction slab ✅

**Objectif (DoD) :** établir une référence électrostatique périodique Float64 contrôlable avant le
smooth PME de performance.

**Livré :** somme Ewald 3D directe pour charges neutres : somme réelle explicite sur images,
structure factors sur la boîte réciproque ±k, auto-énergie analytique, forces réelles/réciproques,
bounds k adaptés à chaque axe et correction de slab Yeh–Berkowitz (énergie + force). Les entrées
non neutres ou mal formées sont refusées au lieu d'ajouter implicitement un fond compensateur.

**Vérifications :** lint + typecheck + **108 tests** (31 fichiers) + build + **7 e2e** verts.
Les 5 nouveaux tests couvrent le gradient d'énergie sur chaque coordonnée, invariance par
translation, force totale nulle, indépendance du paramètre de séparation α après convergence,
correction slab analytique et validation des entrées.

**Déviations au plan :** cet oracle O(N²·Nimages + N·Nk) est volontairement lent. Il sert à valider
PME et les petits golden states, jamais la production à 1 024 molécules.

---

## P43 — Oracle périodique TIP4P/2005 complet ✅

**Objectif (DoD) :** réunir la géométrie TIP4P/2005, le site virtuel et Ewald dans un même champ de
force périodique vérifiable, puis exposer le viriel scalaire nécessaire aux contrôles de pression.

**Livré :** champ de force CPU Float64 TIP4P/2005 périodique : Lennard-Jones O–O à force décalée,
charges H/H/M sommées par Ewald direct, correction de slab optionnelle et redistribution exacte de
la force du site M. Les molécules traversant une frontière sont reconstruites par image minimale
autour de O avant de placer M. Ewald fournit désormais son viriel scalaire (réel, réciproque et
correction slab), contrôlé par dérivée de l'énergie sous dilatation isotrope.

**Vérifications :** lint + typecheck et **9 tests ciblés** verts. Les nouveaux contrôles couvrent le
gradient d'énergie sur toutes les coordonnées massives, la conservation de la force totale,
l'invariance lorsqu'un H est déplacé d'un vecteur de maille, le viriel Ewald et la correction slab.

**Déviations au plan :** aucune. Ce chemin reste un oracle de petits systèmes ; il n'est pas utilisé
par la scène de production tant que smooth PME n'a pas démontré sa parité énergie/forces/viriel.

---

## P44 — Route thermodynamique test-area ✅

**Objectif (DoD) :** mesurer γ par une dérivée d'énergie libre indépendante d'un tenseur de viriel
de contraintes, sans déformer les molécules rigides.

**Livré :** perturbations symétriques A±δA à volume constant, appliquées uniquement aux centres de
masse moléculaires après reconstruction PBC ; les coordonnées internes restent intactes. Calcul de
ΔF± par moyenne exponentielle log-sum-exp stable, dérivée centrale avec nombre d'interfaces
explicite, estimation par blocs et erreur standard. Le protocole et sa formule sont détaillés dans
`docs/EXPERIMENT-L11.md`.

**Vérifications :** lint + typecheck et **7 nouveaux tests** : conservation du volume, aire cible,
géométrie rigide, molécule traversant une face périodique, dérivée analytique exacte, stabilité
numérique, blocs incomplets, absence de mutation et perturbations réelles avec TIP4P/2005/Ewald.

**Déviations au plan :** la route mécanique n'est pas déclarée complète : son tenseur réciproque et
le viriel des contraintes rigides doivent encore être dérivés et testés. Test-area fournit entre-
temps la première route quantitative scientifiquement fermée.

---

## P45 — Noyau FFT Float64 pour smooth PME ✅

**Objectif (DoD) :** disposer d'une transformée 3D déterministe et testée, sans dépendance opaque,
avant d'implémenter l'assignation B-spline et l'influence PME.

**Livré :** FFT complexe radix-2 en place, permutation bit-reversal, transformée inverse normalisée
et décomposition 3D séparable sur grilles rectangulaires x-fastest. Les dimensions et tailles de
buffers invalides sont refusées explicitement.

**Vérifications :** lint + typecheck et **4 nouveaux tests** : égalité à la DFT complexe directe,
round-trip 1D, round-trip 3D non cubique et validations d'entrée.

**Déviations au plan :** aucune. Ce noyau est une fondation ; il ne constitue pas encore PME et ne
modifie donc aucun chemin physique de production.

---

## P46 — Smooth PME CPU validé contre Ewald direct ✅

**Objectif (DoD) :** remplacer la somme réciproque directe par un chemin maillé rapide sans perdre
la précision énergie/forces/viriel de l'oracle.

**Livré :** smooth PME Float64, B-splines cardinales d'ordre 6, assignation/dérivée analytique,
déconvolution, FFT 3D, espace réel erfc, auto-énergie, viriel et correction Yeh–Berkowitz. Projection
du minuscule mode de translation du maillage pour ΣF=0. Le raccord TIP4P/2005 soustrait désormais
exactement les trois paires de charges intramoléculaires exclues. Ewald/PME utilisent une `erfc`
par série et fraction continue quasi machine-précision, cohérente avec la dérivée analytique ; Wolf
conserve son approximation rapide bornée à ≈1,2×10⁻⁷ pour ne pas ralentir les scènes temps réel.

**Vérifications :** golden state anisotrope PME 64×64×128 ↔ Ewald convergé : erreur RMS relative de
force ≈ **1,6×10⁻⁶** (critère ≤10⁻⁵), erreur relative du viriel ≈ **4,5×10⁻⁷**, énergie absolue
≈ 7,1×10⁻⁶ kJ·mol⁻¹ et force totale nulle. Gradient numérique PME et gradient moléculaire avec
exclusions verts ; références `erfc` de x=0 à 5 et dérivée analytique testées.

**Déviations au plan :** PME est scientifiquement validé mais pas encore activé en scène : les
sommes réelles PME et LJ sont toujours O(N²). Une liste de cellules sans exclusions manquées est
requise avant le système de 1 024 molécules.

---

## P47 — Voisins O(N) pour PME réel et LJ TIP4P/2005 ✅

**Objectif (DoD) :** supprimer les doubles boucles de paires du chemin TIP4P/2005 de production,
y compris dans une boîte de slab qui ne contient que deux cellules transverses.

**Livré :** parcours linked-cell générique sur buffers de positions (sites virtuels inclus), avec
déduplication des cellules voisines lorsque les offsets périodiques aliasent pour 1–2 cellules par
axe. L'espace réel erfc PME et le Lennard-Jones O–O utilisent ce parcours ; les sommes réciproques
restent FFT O(M log M).

**Vérifications :** **4 nouveaux tests** comparent exhaustivement les paires à la boucle brute dans
des grilles à 8, 2 et 1 cellule(s), vérifient l'absence de doublons, un site hors boîte et les entrées.
Parité Ewald/PME et gradient moléculaire inchangés. Benchmark informatif local : **≈0,82 s** pour un
calcul de forces 1 024 eaux, grille 64×64×256, toutes valeurs finies.

**Déviations au plan :** le CPU accéléré reste un oracle de golden states : 0,82 s/force implique
plusieurs jours par ns. La scène devra distinguer explicitement aperçu réduit et production ; les
trajectoires convergées et le temps réel attendent PME GPU.

---

## P48 — Builder reproductible du slab eau–vapeur ✅

**Objectif (DoD) :** produire l'état initial exact de l'expérience, avec densité, vide, géométrie
rigide et graines contrôlés, indépendamment de l'UI.

**Livré :** `buildTip4p2005Slab` calcule l'épaisseur depuis N, la masse TIP4P/2005, Lx·Ly et ρ cible,
factorise un réseau d'oxygènes BCC adapté aux dimensions, centre la couche sur z et conserve les
orientations SO(3), vitesses de Maxwell, contraintes et render bonds du builder validé.

**Vérifications :** **2 nouveaux tests** sur 1 024 molécules : densité exactement 997 kg·m⁻³,
épaisseur ≈3,00 nm, vide centré, 1 024 géométries O–H intactes ; rejet des comptes impairs, densités
invalides et slabs ne tenant pas dans la boîte.

**Déviations au plan :** l'état BCC est volontairement un packing initial sans recouvrement, pas un
liquide déjà équilibré. Le protocole impose une fusion/équilibration avant toute collecte.

---

## P49 — Runner NVT contraint et collecte quantitative ✅

**Objectif (DoD) :** faire évoluer le slab avec le modèle validé et produire les données brutes de
l'expérience sans dépendre de l'ancien moteur SPC/Wolf ni de l'UI.

**Livré :** runner `SurfaceTensionExperiment` déterministe : Velocity-Verlet 2 fs, SHAKE/RATTLE,
projection initiale des vitesses, température à 6N−3 degrés de liberté, thermostat CSVR, PME+slab,
énergies, T, profil ρ(z), collecte test-area non destructive et estimation par blocs. Configuration
de référence 1 024 molécules/3,2×3,2×10 nm/300 K/grille 64×64×256.

**Vérifications :** **3 nouveaux tests** : température initiale exacte, trajectoires graine-identiques,
géométrie rigide après intégration, progression temps/pas, profil de densité, ΔU± finis, estimation
par blocs, absence de mutation lors des perturbations et validation des pas. Sanity réel 1 024 :
initialisation ≈1,01 s, premier pas ≈1,13 s, T0=300 K puis T1≈315 K, toutes énergies finies.

**Déviations au plan :** aucune mesure du premier pas n'est interprétée : la hausse est la relaxation
du réseau initial et confirme le besoin des ≥200 ps d'équilibration. Le runner CPU reste un oracle.

---

## P50 — Niveau L11 et laboratoire quantitatif interactif ✅

**Objectif (DoD) :** rendre la nouvelle expérience accessible dans l'application sans confondre une
animation courte avec une mesure convergée.

**Livré :** registre/Zod/CpuEngine étendus à L11, boîte anisotrope, scène 256 molécules et oracle
1 024. Tableau de bord dédié : phase et progression 200 ps, préréglages 280–340 K, T, γ±SEM,
référence IAPWS, formule test-area, profil ρ(z) lissé, historiques, collecte ΔU±, tailles aperçu/oracle
et critères d'intégrité. Le packing choisit BCC/FCC (distance O–O aperçu >0,31 nm) et un calendrier
CSVR fort→faible stabilise la fusion sans contaminer la production.

**Vérifications :** **3 nouveaux tests unitaires** (IAPWS, packing aperçu, contrat CpuEngine L11),
**148 tests** totaux, build vert. Nouveau e2e L11 : chargement, canvas ρ(z), T stable 250–450 K,
zéro exception. Inspection navigateur réel 1 280×720 : T≈319–334 K pendant les premiers pas,
aucun overflow ; deux collectes donnent bien un estimateur γ et l'interface reste réactive.

**Déviations au plan :** la valeur γ initiale (non équilibrée) peut être très loin d'IAPWS et reste
étiquetée exploratoire. L'oracle 1 024 est chargeable mais volontairement en pause/CPU lent.

---

## P51 — Atlas physique étendu à L11 ✅

**Objectif (DoD) :** documenter le nouveau niveau avec la même profondeur, la même vulgarisation et
la même honnêteté quantitative que L0–L10.

**Livré :** `doc/index.html` passe à 12 niveaux/L0→L11. La carte L11 explique intuition du test-area,
TIP4P/2005, site M, PME, correction de slab, déformation des centres de masse, moyenne exponentielle,
incertitude et protocole. Son approfondissement détaille algorithme, toutes les constantes, preuves
des tests et limites CPU/GPU. Ajout de γ et ρ(z) aux observables, PME à la matrice de précision et
distinction explicite L7 qualitatif ↔ L11 quantitatif.

**Vérifications :** syntaxe JavaScript de la page compilée, **12 cartes**, objet expert L11, zéro
erreur KaTeX et zéro overflow à 1 280 px. Navigation réelle jusqu'à L11 vérifiée ; `scroll-margin`
empêche désormais la barre fixe de masquer le titre ciblé.

**Déviations au plan :** aucune. Les critères non encore démontrés (production ns, GPU PME, route
mécanique complète et convergence de taille) sont affichés comme limites, jamais comme acquis.

---

## P52 — Correction de dispersion inhomogène du slab ✅

**Objectif (DoD) :** supprimer le biais dominant du cutoff LJ sur γ sans appliquer une correction
bulk homogène invalide à une interface.

**Livré :** correction Janeček basée sur le profil instantané ρO(z) : énergie, force normale complète
(dérivée + terme de surface au cutoff), viriel, auto-exclusion et huit images périodiques. Le chemin
L11 utilise LJ brut jusqu'à min(5σ, 0,49Lmin), puis cette queue ; A±δA la recalcule automatiquement.

**Vérifications :** **3 nouveaux tests** : limite énergétique bulk à moins de 2 % pour rc=0,8/0,9/
1,1 nm, ΣFz≈0, forces des deux faces orientées vers le cœur dense, invariance sous translation d'une
maille. Runner/PME/gradient legacy restent verts ; aperçu 256 à 20 pas : T≈298,6 K, énergies finies.

**Déviations au plan :** correction de profil CPU plutôt que dispersion PME. Elle est adaptée au slab
planaire visé ; le portage GPU pourra choisir la même convolution 1D ou LJ-PME après parité.

---

## P53 — Route mécanique diagonale pour corps rigides ✅

**Objectif (DoD) :** fournir une seconde estimation de γ sans polluer la pression par les rotations
internes ou des forces de contrainte SHAKE difficiles à reconstruire.

**Livré :** tenseur cinétique des centres de masse moléculaires ; viriel diagonal robuste par
Wαα=−∂U/∂εα sur six log-strains centraux qui conservent la géométrie interne. Pression diagonale,
γ mécanique, moyenne/SEM et écart mécanique−test-area sont collectés avec chaque configuration et
affichés dans le laboratoire.

**Vérifications :** **4 nouveaux tests** : cinétique COM analytique, dérivées exactes d'une énergie
logarithmique de boîte, identité planaire γ, garde-fou de strain et TIP4P/2005 réel où mécanique ↔
test-area converge à **<0,2 %** quand δ→0.

**Déviations au plan :** Pxx/Pyy/Pzz sont complets pour γ ; Pxy/Pxz/Pyz instantanés restent à faire.
Ils valent zéro en moyenne par symétrie du slab, mais ne sont pas déclarés implémentés.

---

## P54 — Fondation FFT radix-2 WebGPU ✅

**Objectif (DoD) :** isoler et valider la primitive numérique la plus risquée du futur smooth PME
GPU avant de l'intégrer aux forces moléculaires.

**Livré :** FFT complexe Float32 radix-2 sur buffers GPU (permutation bit-reversal, passes papillon
séparées, transformée inverse normalisée), harnais de parité avec l'oracle FFT Float64 et point de
lecture DOM opt-in `?gpu-fft=N` pour les navigateurs dont le contexte d'inspection est isolé.

**Vérifications :** **2 nouveaux tests** de topologie/validation. Dans un vrai navigateur WebGPU,
N=64 donne une erreur relative aller de **5,01×10⁻⁸** et un aller-retour de **2,03×10⁻⁷** ; N=256
donne respectivement **6,99×10⁻⁸** et **3,00×10⁻⁷**, sans erreur shader. Lint, typecheck et build
verts ; le test readback reste explicitement ignoré en headless, conformément à la limite `mapAsync`.

**Déviations au plan :** cette phase valide la brique 1D seulement. La FFT 3D batchée, l'assignation
B-spline, la fonction d'influence et l'interpolation des forces seront ajoutées et comparées au CPU
avant d'autoriser L11 sur GPU.

---

## P55 — FFT 3D batchée et stridée WebGPU ✅

**Objectif (DoD) :** transformer directement un maillage x-fastest anisotrope, sans copies ni
transpositions CPU, et démontrer l'indexation de chaque axe contre l'oracle Float64.

**Livré :** FFT 3D séparable Float32 avec bit-reversal et papillons batchés pour les lignes x, y et z,
strides natifs dans un buffer GPU unique et normalisation inverse globale 1/(NxNyNz). Le harnais et
son pont DOM acceptent désormais `?gpu-fft3d=Nx×Ny×Nz`.

**Vérifications :** **1 nouveau test** de contrat dimensionnel. En navigateur WebGPU réel, 8×4×4
donne une erreur relative aller de **7,27×10⁻⁸** et un aller-retour de **1,95×10⁻⁷** ; 16×8×4 donne
**4,80×10⁻⁸** et **1,80×10⁻⁷**. Les deux grilles anisotropes exercent les trois strides sans erreur
shader. Lint, typecheck, tests, build et e2e verts.

**Déviations au plan :** aucune pour la FFT. L11 reste CPU jusqu'à parité de toute la chaîne PME
(charges B-spline → influence réciproque → champ → interpolation → forces + correction de slab).

---

## P56 — Chemin réciproque smooth-PME WebGPU ✅

**Objectif (DoD) :** reproduire sur le GPU la chaîne réciproque d'ordre 6, depuis les sites chargés
jusqu'aux forces interpolées, et la comparer directement à l'oracle Float64.

**Livré :** assignation B-spline 6×6×6 avec atomiques i32 à point fixe (résolution <6×10⁻⁸ e),
déquantification, FFT 3D, fonction d'influence partagée avec le CPU, FFT inverse, différentiation
analytique des mêmes splines et réduction déterministe des 216 contributions par site. Le readback
retire explicitement le padding vec3 WebGPU. Harnais opt-in `?gpu-pme=Nx×Ny×Nz` avec diagnostics.

**Vérifications :** **1 nouveau test** de contrat/neutralité ; le refactoring de l'influence conserve
les goldens PME/direct-Ewald. En navigateur WebGPU réel, l'erreur relative des forces réciproques est
**3,81×10⁻⁵** sur 8×8×16 et **7,67×10⁻⁵** sur 16×16×32 (18/18 composantes finies), très sous le
seuil de parité 5×10⁻³. Lint, typecheck, tests, build et e2e verts.

**Déviations au plan :** la phase couvre la force réciproque, pas encore sa réduction énergie/viriel.
Le temps de première compilation TSL est élevé ; les dispatchs réutilisent ensuite les pipelines.
Le réel Ewald, l'auto-énergie, Yeh–Berkowitz et le transfert site M→atomes restent à intégrer au moteur.

---

## P57 — Énergie et viriel réciproques PME WebGPU ✅

**Objectif (DoD) :** produire les deux scalaires thermodynamiques à partir du même spectre que les
forces, afin que test-area et pression mécanique ne reposent pas sur une reconstruction différente.

**Livré :** facteur viriel par mode partagé CPU/GPU, stockage de ½G(k)|ρ(k)|² avant convolution,
viriel réciproque associé et readback/sommation Float64. L'origine k=0 reste exactement nulle et les
spectres conjugués sont testés. Le harnais compare simultanément force, énergie et viriel.

**Vérifications :** **1 nouveau test** spectral. En navigateur réel : sur 8×8×16, erreurs relatives
force/énergie/viriel = **3,81×10⁻⁵ / 6,61×10⁻⁶ / 2,25×10⁻⁵** ; sur 16×16×32 =
**7,67×10⁻⁵ / 5,03×10⁻⁶ / 1,93×10⁻⁵**. Toutes les composantes sont finies et les seuils e2e
headed sont 5×10⁻³ (force) et 5×10⁻⁴ (énergie/viriel).

**Déviations au plan :** la somme finale est faite après readback pour l'observable de validation ;
les forces restent 100 % device-side. Une réduction hiérarchique GPU ne devient utile que si la
mesure d'énergie à chaque pas est requise, ce qui n'est pas le protocole de production.

---

## P58 — Ewald complet et correction de slab WebGPU ✅

**Objectif (DoD) :** compléter le chemin maillage par le réel courte portée, l'auto-énergie et la
correction Yeh–Berkowitz, puis comparer le résultat total à `computeSmoothPme`.

**Livré :** somme O(N²) minimum-image `erfc(αr)/r` en Float32, forces et viriel analytiques,
auto-énergie `−kₑαΣq²/√π`, réduction du dipôle Mz device-side, énergie de slab `2πkₑMz²/V` et force
`−4πkₑqMz/V`. `computeFull()` additionne ces forces aux forces réciproques sans readback ; les
observables ne sont lues que sur demande. Garde-fou strict du rayon minimum-image.

**Vérifications :** parité réelle WebGPU contre le CPU Float64 sur 8×8×16, rc=1,1 nm et slab actif :
erreurs relatives **2,24×10⁻⁵** (force totale), **2,51×10⁻⁵** (énergie totale) et **3,62×10⁻⁵**
(viriel total). Le test headed dédié impose 5×10⁻³ / 5×10⁻⁴ / 5×10⁻⁴. Contrat de cutoff étendu ;
lint, typecheck, **160 tests**, build et e2e verts.

**Déviations au plan :** le réel est volontairement O(N²) dans cette première version, comme le
chemin moléculaire GPU déjà validé pour les petits systèmes. Une cell-list de sites virtuels pourra
être ajoutée après l'intégration TIP4P, sans modifier l'oracle ni les formules.

---

## P59 — Exclusions TIP4P et transfert du site virtuel WebGPU ✅

**Objectif (DoD) :** reproduire les conventions moléculaires TIP4P/2005 après Ewald : aucune
interaction H1–H2/H1–M/H2–M interne et force M redistribuée exactement vers O/H/H.

**Livré :** groupes d'exclusion du réel PME, correction réciproque stable `erf(αr)/r` (algébriquement
équivalente à `erfc + réciproque − 1/r`, sans annulation catastrophique Float32), minimum-image,
énergie/viriel exclus séparés et transposée du Jacobien affine du site M. Nouveau wrapper
`GpuTip4pPme` qui expose forces de sites et forces atomiques ; harnais `?gpu-tip4p=…`.

**Vérifications :** **1 nouveau test** de contrat TIP4P. Étude de convergence headed : erreur de
force atomique 1,60 % (8×8×16), 0,83 % (16×16×32), puis **9,93×10⁻⁴** sur 32×32×64 ; sites et
atomes donnent le même ratio, validant le transfert M. À 32×32×64, erreurs absolues énergie/viriel
= **9,20×10⁻⁴ / 2,10×10⁻³ kJ·mol⁻¹**. Critère scalaire mixte `|Δ|/max(1,|ref|)` <5×10⁻³,
adapté aux totaux proches de zéro par annulation. Lint, typecheck, tests, build et e2e verts.

**Déviations au plan :** une grille minimale 32×32×64 est imposée par la précision TIP4P ; la grille
L11 réelle (aperçu ≈32×32×128, référence 64×64×256 selon la boîte) est au moins aussi fine. La
construction dynamique des sites depuis les positions atomiques doit encore être intégrée au moteur.

---

## P60 — Sites virtuels dynamiques et builder L11 partagé ✅

**Objectif (DoD) :** supprimer les positions de sites figées du harnais et construire le même slab
initial dans les moteurs CPU/GPU, préalable à une trajectoire réelle.

**Livré :** `buildSystem()` sait construire L11 (boîte anisotrope, slab TIP4P, contraintes, projection
RATTLE et remise exacte à T cible) en lock-step avec `SurfaceTensionExperiment`. `GpuTip4pPme`
accepte le buffer atomique vivant et reconstruit à chaque solve H1/H2 déroulés autour de O puis
`M=O+γ/2(dOH1+dOH2)` sur le device. Les sites initiaux du test sont volontairement tous nuls.

**Vérifications :** **1 nouveau test** lock-step L11 positions/vitesses à 10 décimales. Validation
headed dynamique sur 32×32×64 : résultats strictement identiques à P59 — **9,93×10⁻⁴** relatif sur
forces site et atomiques, erreurs scalées **9,20×10⁻⁴ / 2,10×10⁻³** énergie/viriel. Cela prouve que
la reconstruction dynamique et le minimum-image ne changent pas l'oracle. Suite complète verte.

**Déviations au plan :** le wrapper dynamique n'est pas encore ordonnancé dans les passes de
Velocity-Verlet de `GpuEngine`; O–O LJ et correction Janeček doivent être réunis avec lui avant de
lever le fallback CPU de L11.

---

## P61 — L11 ordonnancé dans GpuEngine (sans queue Janeček) ✅

**Objectif (DoD) :** brancher LJ O–O brut, PME TIP4P et SHAKE/RATTLE dans le vrai Velocity-Verlet,
sans annoncer prématurément L11 comme supporté.

**Livré :** listes de kernels FFT/PME batchables avec barrières conservées ; `GpuEngine` construit le
PME dynamique L11, désactive Wolf, calcule le LJ O–O non shifté jusqu'au cutoff L11, ajoute les forces
TIP4P aux atomes et expose les observables PME. Correction générale du padding vec3 readback, du
volume anisotrope et des degrés de liberté rigides (`3Nat−Ncontraintes−3`). Le support UI reste fermé.

**Vérifications :** **2 nouveaux tests** (unpack vec3 + contrat constructeur L11). En navigateur
réel, force initiale GpuEngine vs CPU raw-LJ/PME : **2,95×10⁻⁴** relatif. Un pas complet NVE
kick→drift→PBC→SHAKE→forces→kick→RATTLE suit le CPU à **1,64×10⁻⁷ nm absolu**
(**2,16×10⁻⁷ relatif**). La FFT batchée conserve son golden 5,01×10⁻⁸.

**Déviations au plan :** Janeček n'est pas encore device-side ; la force de parité la neutralise
explicitement des deux côtés (`dispersionTailBins: 0`). `gpuSupportsConfig(L11)` reste donc faux.

---

## P62 — Janeček + vrai CSVR device-side ; support L11 WebGPU ✅

**Objectif (DoD) :** porter le dernier terme de force, vérifier le NVT réel en navigateur et ne
lever le fallback qu'après stabilité thermique.

**Livré :** convolution Janeček ρO(z) en quatre passes GPU (clear/bin/evaluate/apply), auto-densité
retirée, 8 images, énergie/force/viriel ajoutés à O. CSVR Bussi device-side : réduction de K,
gaussiennes Box–Muller issues du PCG entier, χ² à `6N−3` ddl, λ par pas et calendrier τ identique au
CPU. L11 rejoint `gpuSupportsConfig` hors NPT ; sélecteur CPU oracle / GPU production dans le labo.
Atlas et AGENTS mis à jour.

**Vérifications :** **2 nouveaux tests** (contrat Janeček, support gate). Parité Janeček Float32 ↔
Float64 : **8,83×10⁻⁷** force, **8,26×10⁻⁷** énergie, **9,34×10⁻⁸** viriel. Force L11 complète
reste à **2,95×10⁻⁴** relatif ; pas contraint complet à **1,64×10⁻⁷ nm**. Essai headed 256 molécules :
l'ancien faux CSVR monte à 935 K ; après correction, **295,7 puis 289,9 K** pour cible 300 K, WebGPU
actif et aucune erreur de page. **166 tests**, build/e2e verts.

**Déviations au plan :** première compilation TSL/PME encore longue. La production 2–5 ns et la
convergence 512/1 024/2 048 restent une campagne scientifique à exécuter, pas une valeur simulée ici.

---

## P63 — Campagne batch L11 reproductible ✅

**Objectif (DoD) :** transformer le protocole affiché dans l'UI en expérience exécutable, traçable
et exportable sans intervention manuelle.

**Livré :** `bun run campaign:surface-tension` exécute par défaut 280/300/320/340 K × 5 graines,
1 024 molécules, 200 ps d'équilibration, 2 ns de production, échantillons 2 ps et blocs 100 ps.
Options CLI pour températures, tailles 512/1 024/2 048, répliques, durées, seed, δA, strain et sortie.
JSON + CSV contiennent les deux routes γ±SEM, leur écart, IAPWS, T finale, graine et temps. Mode
`--quick` borné pour CI/smoke test ; le README et l'atlas donnent la commande.

**Vérifications :** **2 nouveaux tests** parser/CSV. Exécution réelle du mode quick de bout en bout :
2 échantillons, JSON/CSV écrits, toutes les valeurs finies ; γ≈49,65 mN/m sur N=8 et 0,004 ps est
explicitement un smoke test non physique, pas un résultat. Typecheck et tests ciblés verts.

**Déviations au plan :** la campagne de plusieurs nanosecondes n'est pas lancée automatiquement :
elle consomme un temps machine substantiel et ses résultats ne doivent être publiés qu'après les
contrôles de convergence documentés.

---

## P64 — Confinement scientifique et correction visible immédiate ✅

**Objectif (DoD) :** premier jalon du programme AAA (voir `tracking-aaa-quality-program.md`) : cesser
de présenter comme certifiés des chemins connus comme invalides ou incomplets, et corriger le défaut
de cardinalité atomique du rendu moléculaire GPU.

**Livré :** nouveau `engine/scientificStatus.ts` (autorité unique du confinement P64 : classification
des niveaux, combinaisons non certifiées, repli sûr, motifs d'indisponibilité, vocabulaire
`demo`/`kernel-validated`/`cross-engine-validated`/`accepted` — aucun niveau n'est `accepted`).
`GpuParticleSystem` instancie `engine.atomCount` au lieu de `config.particleCount` : les scènes
moléculaires GPU n'affichaient qu'un tiers de leurs atomes. Le NPT moléculaire et Langevin sous
contraintes sont refusés par le schéma Zod à l'import et désactivés dans l'UI. La température GPU
étant liée au constructeur, le panneau et le labo L11 déclenchent une reconstruction au lieu d'un
setter silencieux. Pression contrainte/L11 et énergies moléculaires GPU s'affichent `Indisponible`
avec motif. « GPU · production » devient « GPU · aperçu trajectoire » (badge non certifié,
échantillonnage désactivé). README/CLAUDE/AGENTS/descriptions de niveaux/exporter corrigés.

**Vérifications :** lint + typecheck verts. **176 tests** (168 + 8 nouveaux : 5 statut scientifique,
2 refus de schéma, 1 contrat `atomCount`). Build vert, **8 e2e** verts (12 GPU quantitatifs toujours
ignorés — P88). En navigateur réel : atomes rendus GPU/CPU **L4 375/375**, **L5 450/450**,
**L7 510/510** (= molécules × 3 ; le GPU affichait 125/150/170 avant). Badge L11 GPU
`GPU · APERÇU NON CERTIFIÉ`, bouton d'échantillonnage désactivé, Langevin/NPT désactivés en L5,
pression `Indisponible`, **zéro erreur de page**.

**Déviations au plan :** aucune. Le crochet `window.__mdScene` utilisé pour mesurer les instances a
été retiré (bundle vérifié) ; un test unitaire fixe désormais `atomCount = 3 × particleCount`.
Restent portés par les phases dédiées : métrique « Particules » (P73), température GPU vive
(P68/P76), certification GPU matérielle (P88).

---

## P65 — Configuration canonique, stricte et versionnée ✅

**Objectif (DoD) :** qu'une configuration ait un sens unique : scènes, imports (et plus tard
restaurations d'instantané) installent exactement ce qu'ils énoncent.

**Livré :** nouveau `state/canonicalConfig.ts` — enveloppe versionnée (`CONFIG_VERSION = 1`) où les
champs optionnels sont sérialisés explicitement (`null`) au lieu d'être supprimés par
`JSON.stringify` : c'est ce qui permettait à un import d'hériter des valeurs de la scène précédente.
Les configs héritées (nues) restent acceptées et normalisées. Schéma `strictObject` : les clés
inconnues sont refusées, et les espèces sont validées contre `SPECIES_LIBRARY` au lieu de retomber
silencieusement sur l'argon. Validation croisée : L9/L10 ne peuvent pas demander le GPU, L11 exige un
nombre pair de molécules, et une boîte périodique L1/L2 doit contenir son propre cutoff non borné.
Le store distingue désormais `replaceConfig` (config complète : scènes, imports) de `patchConfig`
(édition d'un champ). `LJ_CUTOFF_FACTOR`/`WCA_CUTOFF_FACTOR` sont exportés pour que la validation
dérive sa limite de la même source que la physique.

**Vérifications :** lint + typecheck verts. **189 tests** (176 → +13). Build vert, **8 e2e** verts.
Les **15 scènes** round-trippent à l'identique via JSON. En navigateur réel : champ électrique actif
(électrophorèse) puis **absent** après import d'une config NaCl sans champ — l'ancien merge le
gardait à 150 ; espèce inconnue **refusée** (`Import refusé : speciesName : Espèce inconnue…`) ;
enveloppe exportée `configVersion: 1`, `initialClump: null` explicite ; **zéro erreur de page**.

**Déviations au plan :** aucune. Ma première règle d'image minimale était fausse (elle rejetait les
scènes L5 1,7 nm et L11 1,8 nm) : la lecture du code montre que `molecular.ts`/`ionic.ts` **bornent**
le cutoff à 0,49·L (perte de précision documentée, valide), seuls `wca.ts`/`lennardJonesCell.ts`
appliquent un cutoff non borné. La règle ne vise donc que L1/L2, avec tests dans les deux sens.

---

## Bilan

**Phases P0–P63 livrées** (**168 tests unitaires/golden + 8 e2e**, lint/typecheck verts).
Moteur CPU validé (oracle déterministe) + moteur GPU WebGPU avec **cell-lists O(N) + thermostat**.

**Physique — échelle complète L0→L11 :** gaz parfait, sphères molles (WCA), Lennard-Jones, **électrostatique
atomistique (Coulomb-Wolf)**, **eau atomistique flexible (SPC/Fw)**, **eau rigide (SHAKE/RATTLE)**,
huile/eau, tension de surface, dissolution, dièdres d'alcane et dissociation de Morse.
L11 ajoute la tension de surface quantitative TIP4P/2005/PME/test-area avec incertitudes.
**Ensembles NVE / NVT (Berendsen, CSVR) / NPT (Berendsen).** **Gravité** (CPU + GPU). Démixtion huile/eau,
ions NaCl, mouvement Brownien, transitions de phase.

**Perf :** cell-lists O(N) CPU **et GPU** (hachage spatial + atomiques) ; rendu GPU-résident.

**Rendu :** sphères instanciées (ACES + éclairage hémisphérique) **ou surface de fluide écran-espace
(metaballs)** ; coloration par espèce / vitesse.

**Outillage :** snapshots/export round-trip (Zod), 15 scènes, graphes temps réel (T, P, énergies, g(r),
démixtion, MSD), déterminisme par seed.

**Limites d'environnement assumées (pas des trous de code) :**
- La **parité numérique GPU↔CPU** et le **rendu visuel** se vérifient en **navigateur réel** : le WebGPU
  **headless** ne résout pas le readback `mapAsync` ni la capture du canvas. Le CI valide compilation +
  dispatch + avancement + zéro exception ; le harnais `window.__md` couvre la parité en vrai navigateur.
- Le GPU couvre **L0–L8 et L11 sans barostat** ; L9/L10 restent sur le CPU faute de kernels dièdres/Morse,
  et NPT reste CPU faute de réduction virielle côté device.

La demande explicite — h₂o + huile, **vraie physique mesurable**, temps réel, niveaux incrémentaux,
WebGPU, tests partout, **+ gravité, GPU et surface de fluide** — est entièrement remplie.

---

## Modèle pour les phases suivantes

```
## Pn — Titre  🟡/✅
**Objectif (DoD) :** …
**Livré :** …
**Vérifications :** …
**Déviations au plan :** … (ou « aucune »)
```
