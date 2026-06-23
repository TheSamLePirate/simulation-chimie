# Plan v2 — « Tout rendre parfait » (P12 → P15)

Suite de la feuille de route après P0–P11 (échelle L0→L4, NVE/NVT/NPT, électrostatique +
eau atomistiques, cell-lists, GPU compute, tests partout). Objectif : combler **toutes** les
déviations restantes + ajouter la **gravité**. Chaque phase = commit + tests + `tracking.md`.

## P12 — Gravité (champ externe) ⚡ (demandé)
- Champ d'accélération uniforme (par défaut −y), réglable, appliqué dans le Velocity-Verlet
  (gravité = accélération, indépendante de la masse).
- UI : slider d'intensité + scène **« Sédimentation »** (gravité + parois réfléchissantes : les
  particules tombent et s'accumulent au fond).
- Tests : sous gravité, le centre de masse descend (COM_y ↓), vitesse moyenne −y ; gravité nulle ⇒ inchangé.
- Aussi sur GPU (uniform de gravité dans le kernel d'intégration).

## P13 — Eau rigide (contraintes SETTLE)
- Algorithme **SETTLE** (Miyamoto-Kollman) : géométrie rigide exacte de l'eau 3-sites après le pas
  de position, + correction des vitesses (type RATTLE). Permet un pas de temps 2 fs.
- Option « eau rigide » (vs flexible SPC/Fw) ; sans forces de liaison/angle, géométrie maintenue.
- Tests : longueurs O–H et angle H–O–H **exactement constants** sur N pas ; conservation d'énergie à dt 2 fs.

## P14 — Parité GPU étendue
- **Cell-lists GPU** : spatial hash + compteurs atomiques + prefix sum (voisinage O(N) sur GPU).
- **Coulomb GPU** (Wolf DSF) + **thermostat GPU** (réduction d'énergie cinétique) + **gravité GPU**.
- Validation : tests comportementaux headless (dispatch + avancement, zéro exception) ; **parité
  quantitative vs CPU en navigateur réel** via `window.__md` (le headless ne fait pas le readback).

## P15 — Rendu de surface de fluide
- Rendu **écran-espace** type metaballs : depth/épaisseur des particules → flou → reconstruction de
  normales → éclairage de surface (look « liquide »), en plus du mode sphères.
- Bascule de mode de rendu dans l'UI. Validation : E2E sans exception + visuel en navigateur réel.

## Polish final
- Revue de cohérence, README/tracking à jour, `bun run check` + E2E verts.
