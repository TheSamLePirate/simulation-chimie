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

## Bilan

**Phases P0–P16 livrées et commitées** (**64 tests unitaires/golden + 7 e2e**, lint/typecheck verts).
Moteur CPU validé (oracle déterministe) + moteur GPU WebGPU avec **cell-lists O(N) + thermostat**.

**Physique — échelle complète L0→L5 :** gaz parfait, sphères molles (WCA), Lennard-Jones, **électrostatique
atomistique (Coulomb-Wolf)**, **eau atomistique flexible (SPC/Fw)**, **eau rigide (SHAKE/RATTLE)**.
**Ensembles NVE / NVT (Berendsen, CSVR) / NPT (Berendsen).** **Gravité** (CPU + GPU). Démixtion huile/eau,
ions NaCl, mouvement Brownien, transitions de phase.

**Perf :** cell-lists O(N) CPU **et GPU** (hachage spatial + atomiques) ; rendu GPU-résident.

**Rendu :** sphères instanciées (ACES + éclairage hémisphérique) **ou surface de fluide écran-espace
(metaballs)** ; coloration par espèce / vitesse.

**Outillage :** snapshots/export round-trip (Zod), 9 scènes, graphes temps réel (T, P, énergies, g(r),
démixtion, MSD), déterminisme par seed.

**Limites d'environnement assumées (pas des trous de code) :**
- La **parité numérique GPU↔CPU** et le **rendu visuel** se vérifient en **navigateur réel** : le WebGPU
  **headless** ne résout pas le readback `mapAsync` ni la capture du canvas. Le CI valide compilation +
  dispatch + avancement + zéro exception ; le harnais `window.__md` couvre la parité en vrai navigateur.
- **Coulomb/eau sur GPU** non portés : le moteur GPU est **mono-espèce** (l'électrostatique y serait non
  physique) — nécessiterait d'abord un GPU multi-espèces.

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
