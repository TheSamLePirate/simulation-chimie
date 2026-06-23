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

## Bilan

**Phases P0–P10 livrées et commitées.** Socle scientifique solide (**59 tests unitaires/golden + 6
e2e**), moteur CPU validé (oracle déterministe) et moteur GPU WebGPU fonctionnel. Échelle de fidélité
complète **L0→L4** : gaz parfait, sphères molles, Lennard-Jones, **électrostatique atomistique
(Coulomb-Wolf)**, **eau atomistique H₂O (SPC/Fw : molécules, liaisons, angles, charges)**. Plus :
thermostats NVT, démixtion huile/eau, ions NaCl, cell-lists O(N), snapshots/export, scènes,
viz par vitesse.

**Déviations restantes (extensions futures, documentées par phase) :**
- **Eau rigide à contraintes SETTLE/RATTLE** (l'eau livrée est *flexible* SPC/Fw — valide, dt ~0.5 fs).
- **Barostat NPT** (les thermostats NVT couvrent température + transitions de phase).
- **GPU** : électrostatique / eau / cell-lists / thermostat non portés sur GPU (CPU = chemin validé ;
  GPU = LJ/WCA O(N²) NVE). Limite d'env : WebGPU headless ne fait ni readback `mapAsync` ni capture canvas.
- **Rendu de surface de fluide** (raymarching/metaballs) — rendu actuel = sphères instanciées + carte de vitesse.

La priorité explicite de l'utilisateur (h₂o + huile + **vraie physique mesurable**, temps réel,
niveaux incrémentaux, WebGPU, tests partout) est remplie, électrostatique et eau atomistique incluses.

---

## Modèle pour les phases suivantes

```
## Pn — Titre  🟡/✅
**Objectif (DoD) :** …
**Livré :** …
**Vérifications :** …
**Déviations au plan :** … (ou « aucune »)
```
