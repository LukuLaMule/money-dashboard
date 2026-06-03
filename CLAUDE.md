# money.luku.fr — Dashboard boursier PEA/CTO (read-only)

Dashboard perso des investissements bourse (PEA + CTO) façon Finary, mais custom,
thème **MLG montage parody** (2013 CSGO/MW2 : hitmarkers, airhorn, pluie Doritos/Mountain Dew).
Public en **lecture seule**.

## Stack & déploiement
- **nginx statique** (`nginx:1.27-alpine`) derrière **Traefik v3** (réseau `web`, SSL Let's Encrypt auto).
- Live sur https://money.luku.fr — router Traefik `money` (labels dans `docker-compose.yml`).
- Aucune base de données. Tout est piloté par `html/data.json`.
- Charts : **Chart.js 4** (CDN jsdelivr).
- Animations : skill **transitions.dev** (number pop-in, tabs sliding, shimmer) — blocs collés verbatim dans `style.css`.

## Lancer / mettre à jour
```bash
cd /home/opc/Docker/sites/money
docker compose up -d        # démarre / recrée
# modif de data.json → servi en live (Cache-Control no-store), pas de rebuild
```

## Fichiers
- `html/index.html` — structure (KPIs, tabs compte, 3 charts, table positions).
- `html/style.css` — thème MLG + blocs transitions.dev.
- `html/app.js` — fetch `data.json`, calcul KPIs, rendu charts, filtre compte, effets MLG.
- `html/data.json` — **source unique des données** (snapshots / dividends / positions). Voir README.md.
- `nginx.conf` — sert le statique, bloque tout sauf GET/HEAD (read-only), no-cache sur data.json.
- `docker-compose.yml` — service `app` + labels Traefik.

## Read-only
nginx renvoie **405** sur toute méthode ≠ GET/HEAD. Pas d'UI d'édition, pas d'API.

## Données (data.json)
3 collections : `snapshots` (date/account/value/invested), `dividends` (date/account/ticker/label/amount),
`positions` (account/ticker/label/shares/pru/last). Données actuelles = DEMO à remplacer par les vrais
historiques. Format détaillé dans `README.md`.
