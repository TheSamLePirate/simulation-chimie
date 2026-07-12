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
- Dispersion : LJ-PME ou correction longue portée inhomogène, validée par convergence en cutoff.
- Production NVT avec CSVR faible ; l'équilibration de densité exige un barostat canonique, pas
  Berendsen.

Références primaires :

- Abascal & Vega, TIP4P/2005, DOI 10.1063/1.2121687.
- Vega & de Miguel, test-area et tension de surface, DOI 10.1063/1.2715577.
- Essmann et al., smooth PME, DOI 10.1063/1.470117.
- Yeh & Berkowitz, Ewald en géométrie slab, DOI 10.1063/1.479595.
- Alejandre & Chapela, dispersion Ewald et taille finie, DOI 10.1063/1.3279128.
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

## Critères d'acceptation

- Forces du site virtuel et forces réciproques conformes au gradient numérique.
- Conservation exacte de la force et du couple lors de la redistribution du site M.
- Géométrie rigide à moins de 10⁻⁶ nm.
- Ewald direct ↔ PME : erreur RMS relative de force ≤ 10⁻⁵ sur les golden states.
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
