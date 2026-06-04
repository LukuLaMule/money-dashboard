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

## Rafraîchissement automatique (cron, sérialisé par flock /tmp/money_refresh.lock)
- `refresh.sh news`   : toutes les heures à :17 — actus Yahoo.
- `refresh.sh prices` : **toutes les 10 min, lun-ven 7h-20h GMT** — cours intraday seulement
  (range 5d, pas d'historique/news/fetch TR), reconstruit data.json. ~10 s par run.
  → le KPI « Aujourd'hui » suit le marché au lieu de rester figé sur les cours de 9h30.
- `refresh.sh full`   : 7h30 GMT — cours + historique 5y + benchmarks + portefeuille TR.
- `refresh_cto.sh`    : **toutes les 30 min (:08/:38)** — CTO Trade Republic + keep-alive session.
  La session web TR survit indéfiniment car `fetch_tr_portfolio.py` re-sauvegarde les cookies
  rotés après chaque resume (`tr.save_websession()`) — sans ça, 2FA requise en quelques heures.
  Si « session TR expirée » dans refresh.log → `/home/opc/tr_scraper/cto_relogin.sh` (2FA une fois).
- KPI « Aujourd'hui » : affiché en centimes (EUR2) quand |PnL| < 10 €, sinon arrondi à l'euro.
- **Titres US du CTO cotés sur les places allemandes** (Stuttgart/Francfort, EUR natif, 8h-22h Paris)
  via `SYMBOL_OVERRIDES` dans `fetch_prices.py` — sinon la variation du jour resterait figée sur la
  clôture US de la veille jusqu'à 15h30 Paris (TR cote via LS Exchange en continu). Nouvelle position
  US dans le CTO → ajouter son ticker allemand dans SYMBOL_OVERRIDES (sinon fallback NYSE/NASDAQ, correct
  mais retardé hors séance US).

## Fichiers
- `html/index.html` — structure (KPIs, tabs compte, 3 charts, table positions).
- `html/style.css` — thème MLG + blocs transitions.dev.
- `html/app.js` — fetch `data.json`, calcul KPIs, rendu charts, filtre compte, effets MLG.
- `html/data.json` — **source unique des données** (snapshots / dividends / positions). Voir README.md.
- `html/intraday.json` — points de valo de la séance (~10 min, par compte) — écrit par `tools/record_value.py`.
- `html/daily.json` — historique JOURNALIER des valos (archivé depuis intraday au changement de jour).
- `html/recap.json` — récap du mois écoulé (perf hors apports, top/flop, dividendes) — `tools/build_recap.py`, cron le 1er à 7h50.
- (intraday/daily/recap/data/news .json = données réelles → gitignorés, repo public)
- `nginx.conf` — sert le statique, bloque tout sauf GET/HEAD (read-only), no-cache sur data.json.
- `docker-compose.yml` — service `app` + labels Traefik.

## Read-only
nginx renvoie **405** sur toute méthode ≠ GET/HEAD. Pas d'UI d'édition, pas d'API.

## Front — fonctionnalités notables
- 6 KPI : valorisation, **Aujourd'hui** (+ sparkline de séance depuis intraday.json), plus-value,
  dividendes, perf positions, **TRI annualisé (XIRR**, bisection, flux = Δinvested mensuels + valeur actuelle).
- Courbe PERFORMANCE : points mensuels (snapshots) **+ points journaliers (daily.json) + point live**
  fusionnés par `combinedPoints()` ; filtre temporel calendaire (1M = 1 mois jour pour jour).
- Table positions : colonne **Jour** (€ et % vs clôture veille, triable).
- **Fraîcheur + marchés** dans le header : « cours mis à jour il y a X min » + statut ouvert/fermé des 6 marchés principaux (Euronext 9h-17h30, Francfort/Stuttgart 8h-22h, NYSE 9h30-16h NY, Londres 8h-16h30, Tokyo 9h-15h30 JST, Crypto 24/7 — fuseaux gérés via Intl, jours fériés non gérés). Horaires au survol.
- Bloc **RÉCAP du mois** (recap.json) : perf hors apports, dividendes, top/flop 3.
- Auto-refresh front : re-fetch data/intraday/daily toutes les 5 min + re-render.

## Données (data.json)
3 collections : `snapshots` (date/account/value/invested), `dividends` (date/account/ticker/label/amount),
`positions` (account/ticker/label/shares/pru/last). Données actuelles = DEMO à remplacer par les vrais
historiques. Format détaillé dans `README.md`.
