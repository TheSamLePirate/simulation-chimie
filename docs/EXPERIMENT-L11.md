# L11 — Tension de surface quantitative de l'eau

## Objectif scientifique

Mesurer la tension de surface d'une interface plane eau–vapeur en fonction de la température,
avec une incertitude statistique explicite et deux routes thermodynamiques indépendantes. Ce niveau
ne remplace pas L7 : L7 reste la démonstration temps réel de sphérification ; L11 devient une
expérience quantitative reproductible.

## Modèle cible

- Eau rigide quatre sites **TIP4P/2005** : rOH = 0,09572 nm, angle HOH = 104,52°, site virtuel M à
  0,01546 nm de O, qH = +0,5564 e, qM = −1,1128 e, σO = 0,31589 nm,
  εO = 0,7749 kJ·mol⁻¹.
- Velocity-Verlet, pas 2 fs, contraintes SETTLE ou SHAKE/RATTLE convergées.
- Électrostatique : Ewald direct comme oracle CPU, puis smooth PME validé contre cet oracle.
- Géométrie de slab : correction électrostatique Yeh–Berkowitz.
- Dispersion : correction longue portée inhomogène de Janeček sur ρ(z), validée par convergence en
  cutoff ; LJ-PME reste l'alternative GPU future.
- Production NVT avec CSVR faible ; l'équilibration de densité exige un barostat canonique, pas
  Berendsen.

Références primaires :

- Abascal & Vega, TIP4P/2005, DOI 10.1063/1.2121687.
- Vega & de Miguel, test-area et tension de surface, DOI 10.1063/1.2715577.
- Essmann et al., smooth PME, DOI 10.1063/1.470117.
- Yeh & Berkowitz, Ewald en géométrie slab, DOI 10.1063/1.479595.
- Alejandre & Chapela, dispersion Ewald et taille finie, DOI 10.1063/1.3279128.
- Janeček, correction longue portée planaire, DOI 10.1021/jp056344z.
- Lishchuk & Fischer, terme de force complet, DOI 10.1063/1.5048925.
- IAPWS R1-76(2014), tension de surface de l'eau ordinaire.

## Géométrie de référence

- 1 024 molécules ; Lx = Ly ≈ 3,2 nm ; Lz = 10–12 nm.
- Slab liquide d'environ 3 nm, centré, avec deux interfaces eau–vapeur.
- Températures : 280, 300, 320 et 340 K ; cinq graines indépendantes.
- Équilibration ≥ 200 ps ; production 2–5 ns ; moyennes par blocs de 100–200 ps.

Une exécution interactive courte est toujours étiquetée **aperçu**. Une mesure publiable exige le
mode batch et la convergence statistique.

## Observables obligatoires

1. Tenseur de pression complet Pxx, Pyy, Pzz, Pxy, Pxz, Pyz.
2. Route mécanique : γ = Lz/2 · [Pzz − (Pxx + Pyy)/2].
3. Route test-area à volume constant, avec déformation des centres de masse moléculaires.
4. Profil de densité massique ρ(z) et largeur interfaciale.
5. gOO(r) dans le cœur liquide, orientation moléculaire et coordination hydrogène.
6. Moyenne par blocs, erreur standard, intervalle de confiance et convergence en taille.

Conversion : 1 kJ·mol⁻¹·nm⁻² = 1,660539067 mN·m⁻¹.

### Estimateur test-area implémenté

Pour chaque configuration non perturbée d'aire A = Lx·Ly, deux états virtuels sont construits avec
A± = A(1±ε), Lx,y± = Lx,y√(1±ε) et Lz± = Lz/(1±ε). Le volume est donc strictement inchangé. La
transformation ne dilate pas les atomes : elle agit uniquement sur le centre de masse de chaque
molécule, après reconstruction par image minimale, puis réinjecte les coordonnées internes intactes.

Les différences d'énergie ΔU± = U(A±)−U(A) donnent ΔF± = −kBT ln⟨exp(−βΔU±)⟩. Pour n interfaces,
la dérivée centrale est γ = (ΔF+−ΔF−)/(2 n δA). L'implémentation utilise log-sum-exp pour éviter
underflow/overflow et réévalue γ sur des blocs complets pour estimer l'erreur standard. ε devra être
balayé en production : assez petit pour rester dans le régime linéaire, mais assez grand pour que le
signal dépasse le bruit numérique.

### Smooth PME CPU validé

Le chemin accéléré assigne les charges sur une grille par B-splines cardinales d'ordre 6, applique
une FFT 3D Float64, déconvolue la fonction d'assignation puis interpole le potentiel. Les forces
proviennent de la dérivée analytique des mêmes poids ; le très petit mode de translation résiduel du
maillage est projeté pour imposer ΣF = 0. L'espace réel conserve erfc(αr)/r, l'auto-énergie et la
correction Yeh–Berkowitz. Les interactions H1–H2/H1–M/H2–M intramoléculaires sont soustraites
explicitement, comme l'exige TIP4P/2005.

Sur le golden state anisotrope actuel (grille 64×64×128), l'erreur RMS relative des forces face à
Ewald direct est ≈ 1,6×10⁻⁶ et l'erreur relative du viriel ≈ 4,5×10⁻⁷. Ces valeurs valident le noyau
numérique. L'espace réel et LJ utilisent désormais une liste de cellules qui reste correcte avec
seulement une ou deux cellules périodiques par axe (déduplication explicite). Un calcul complet de
forces pour 1 024 molécules sur grille 64×64×256 prend environ 0,82 s sur la machine de développement.
Cela convient aux golden states et aux validations courtes, mais **pas** à une trajectoire de plusieurs
nanosecondes (plusieurs jours CPU). Production batch et aperçu interactif attendent donc le portage
GPU FFT/PME ; l'UI ne devra jamais présenter un run CPU court comme une mesure convergée.

### Dispersion longue portée du slab

Le LJ O–O explicite utilise jusqu'à 5σ lorsque la boîte le permet. Au-delà, le profil instantané de
densité numérique des oxygènes est convolué avec le noyau planaire analytique de Janeček. L'énergie
par site emploie
8πε[σ¹²/(10R¹⁰)−σ⁶/(4R⁴)], R=max(rc,|Δz|). La force normale ajoute la dérivée pour |Δz|>rc et le
terme de surface −2πu(rc)∫ρ(z₂)Δz dz₂ pour |Δz|≤rc, terme nécessaire que la dérivée naïve de
l'énergie omet. Les copies périodiques du profil sont sommées sur huit couches et la contribution du
site lui-même est retirée. La même correction est recalculée dans A±δA : elle contribue donc à la
dérivée test-area au lieu d'être ajoutée après coup.

### État initial du slab

Le builder dédié calcule l'épaisseur liquide depuis la masse moléculaire et la densité cible :
Lliq = N·M·1,6605390666/(ρ·Lx·Ly). Pour N=1 024, Lx=Ly=3,2 nm et ρ=997 kg·m⁻³,
Lliq≈3,00 nm dans une boîte Lz=10 nm. Les oxygènes sont initialisés sur un réseau BCC factorisé
suivant les dimensions du slab, les orientations sont uniformes dans SO(3), puis SHAKE/RATTLE
maintient rOH et rHH. Cette structure initiale ordonnée doit être fondue et équilibrée avant mesure.

### Runner de référence

`SurfaceTensionExperiment` assemble le builder, TIP4P/2005+PME, SHAKE/RATTLE et Velocity-Verlet à
2 fs. Les vitesses atomiques sont d'abord projetées dans l'espace tangent rigide, puis normalisées
avec **6N−3 degrés de liberté** ; le thermostat de production est CSVR avec τ=1 ps. Le runner expose
les énergies/T instantanées, ρ(z), la collecte ΔU± et l'estimation test-area par blocs. Il est
déterministe pour une graine donnée et destiné à l'oracle/golden CPU ; l'orchestrateur de protocole
et le backend GPU pourront réutiliser exactement ce contrat de mesures.

Sanity check 1 024 molécules : T(0)=300,000 K, énergie potentielle initiale finie, puis T≈315 K au
premier pas pendant la relaxation du packing. Aucune donnée ne doit donc être collectée avant la
phase d'équilibration spécifiée.

### Laboratoire interactif L11

L11 est enregistré dans l'échelle de précision et possède une scène dédiée. L'aperçu affiche 256
molécules dans 1,8×1,8×8 nm avec une grille PME 32×32×128 et un pas par image ; l'oracle charge la
géométrie 1 024/64×64×256 en pause. Le tableau de bord montre phase/temps d'équilibration, T,
γ test-area ± erreur, référence IAPWS à la température choisie, ρ(z), historiques T/γ et nombre de
configurations. Le bouton d'échantillonnage est explicitement **exploratoire** avant 200 ps.

Le packing choisit automatiquement BCC ou FCC pour maximiser la distance O–O selon la géométrie :
l'aperçu FCC reste >0,31 nm. Pendant la fusion initiale, CSVR couple à τ=Δt jusqu'à 1 ps, puis relâche
progressivement vers τ=1 ps à 50 ps ; la production utilise ainsi le couplage faible prévu sans
laisser l'énergie du réseau initial porter T à des valeurs non physiques.

## Critères d'acceptation

- Forces du site virtuel et forces réciproques conformes au gradient numérique.
- Conservation exacte de la force et du couple lors de la redistribution du site M.
- Géométrie rigide à moins de 10⁻⁶ nm.
- Ewald direct ↔ PME : erreur RMS relative de force ≤ 10⁻⁵ sur les golden states.
- Correction LJ planaire : énergie bulk analytique à moins de 2 % pour rc=0,8/0,9/1,1 nm et ΣFz=0.
- Densité TIP4P/2005 à 300 K / 1 bar à moins de 0,2 % de la référence du modèle.
- Route mécanique ↔ test-area : écart ≤ 2 mN·m⁻¹.
- Incertitude statistique finale ≤ 2 mN·m⁻¹.
- Convergence 512 / 1 024 / 2 048 molécules dans l'incertitude annoncée.
- Courbe γ(T) compatible avec la littérature TIP4P/2005 et à moins de 5 % d'IAPWS.

## Ordre d'implémentation

1. Observables tensoriels, profil de densité, blocs statistiques.
2. Builder TIP4P/2005 et site virtuel, CPU Float64.
3. Ewald direct + correction slab, tests de gradient et golden states.
4. Viriel tensoriel complet, incluant réciproque et contraintes ; route mécanique.
5. Route test-area, convergence et incertitude.
6. Smooth PME CPU puis WebGPU, jamais activé avant parité avec l'oracle.
7. Scène, graphes et mode batch de l'expérience.
