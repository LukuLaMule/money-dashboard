<div align="center">

<img src="docs/banner.png" width="100%" alt="money.luku.fr — Deviens riche comme Luku" />

**Dashboard d'investissement boursier perso (PEA + CTO)** — auto-hébergé, *read-only*, 4 thèmes, et carrément trop stylé.

[![Made with Chart.js](https://img.shields.io/badge/charts-Chart.js%204-ff6384?style=for-the-badge&logo=chart.js&logoColor=white)](https://www.chartjs.org/)
[![Vanilla JS](https://img.shields.io/badge/JS-vanilla-f7df1e?style=for-the-badge&logo=javascript&logoColor=black)](#)
[![PWA](https://img.shields.io/badge/PWA-installable-5a0fc8?style=for-the-badge&logo=pwa&logoColor=white)](#)
[![Themes](https://img.shields.io/badge/thèmes-4-39ff14?style=for-the-badge)](#-4-thèmes)
[![No tracking](https://img.shields.io/badge/tracking-0-success?style=for-the-badge)](#-vie-privée)

<img src="docs/themes.gif" width="85%" alt="Les 4 thèmes en action" />

</div>

---

## ✨ C'est quoi ?

Un tableau de bord façon **Finary**, mais **fait main et 100 % à moi** : il agrège mon **PEA** (Bourse Direct) et mon **CTO** (Trade Republic), trace ma performance réelle, mes dividendes, mon allocation, et projette mon patrimoine futur. Le tout en site **statique** (zéro base de données), servi par nginx derrière Traefik, et **rafraîchi tout seul** chaque jour.

> ⚠️ Les **données affichées dans les captures sont fictives**. Mes vraies données financières ne sont **jamais** commitées (voir [Vie privée](#-vie-privée)).

---

## 🎨 4 thèmes

Un sélecteur en haut de page, mémorisé entre les visites. Chaque thème change palette, polices **et** couleurs des graphiques.

| ⚪ Pur — minimal façon Apple | 📈 Performance — terminal trading |
|:---:|:---:|
| ![Pur](docs/screens/theme-pur.png) | ![Performance](docs/screens/theme-performance.png) |
| 💎 **Wealth — luxe or sur noir** | 🎮 **MLG — montage parody 2013** |
| ![Wealth](docs/screens/theme-wealth.png) | ![MLG](docs/screens/theme-mlg.png) |

---

## 🚀 Fonctionnalités

- 📊 **Courbe de performance** — valeur de marché vs apports investis : historique mensuel + **points journaliers** + point live.
- ⚡ **Quasi temps réel** — cours rafraîchis **toutes les 10 min** pendant les heures de marché (titres US cotés sur les places allemandes, EUR natif, 8h-22h) ; **sparkline de la séance**, **variation du jour par ligne**, indicateur de **fraîcheur** + statut d'ouverture des **6 marchés principaux**.
- 🎯 **KPIs** — valorisation, **aujourd'hui**, plus-value, dividendes encaissés, perf des positions depuis l'achat, **TRI annualisé (XIRR)** (avec tooltips explicatifs).
- 🗓️ **Récap mensuel auto** — perf hors apports, top/flop, dividendes, comparatif 6 mois (généré le 1er du mois).
- 🔥 **Heatmap calendrier** — perf quotidienne façon GitHub (s'enrichit jour après jour).
- 🔍 **Fiche par position** — clic sur une ligne : courbe du titre vs PRU, poids, dividendes de la ligne.
- 🔔 **Alertes ntfy** — push si une position fait ±5 % dans la journée ou si la session TR expire.
- 🥧 **Allocation** par ligne + **répartition par pays** 🌍 et par **secteur** 🏷️ (barres animées).
- 🤑 **Dividendes** — historique mensuel, **rendement annuel**, et **calendrier prévisionnel** des 12 prochains mois (filtré sur les lignes encore détenues).
- 🔮 **Prévisionnel** — projection par scénarios à rendement réglable, **dividendes réinvestis** et **effet de levier pondéré** par la composition réelle, en euros constants en option.
- 📈 **Comparaison vs indices** — « et si j'avais investi mes apports sur le **S&P 500 / CAC 40 / MSCI World** ? » (simulation DCA).
- ⏱️ **Filtre temporel** 1M / 6M / 1A / 3A / Max, table de positions **triable**.
- 📱 **PWA installable** + **responsive** mobile / tablette (iOS & Android).
- 🔒 **Read-only** : nginx bloque toute méthode ≠ GET/HEAD.

---

## 🛠️ Stack

| | |
|---|---|
| **Front** | HTML / CSS / **vanilla JS**, [Chart.js 4](https://www.chartjs.org/), animations [transitions.dev](https://transitions.dev) (number pop-in, tabs, tooltip, dropdown…) |
| **Serveur** | nginx statique derrière **Traefik** (SSL Let's Encrypt auto) |
| **Données** | scripts **Python** (stdlib) — aucun framework, aucune DB |
| **Cours** | Yahoo Finance (cours actuels + historique, conversion FX) |
| **Auto** | `cron` : cours **toutes les 10 min** (heures de marché), portefeuille TR toutes les 30 min (session web entretenue sans 2FA), news chaque heure, full + récap mensuel |

---

## 🔌 Sources de données

| Compte | Source | Récupération |
|---|---|---|
| **PEA** | Bourse Direct — avis d'opéré CSV | positions, PRU (coût moyen), dividendes, apports |
| **CTO** | Trade Republic — API WebSocket `compactPortfolioByTypeV2` | positions, parts & PRU exacts, dividendes, apports |

Tout est converti en un seul fichier **`data.json`** qui pilote le dashboard.

---

## 🏃 Lancer en local

```bash
git clone https://github.com/LukuLaMule/money-dashboard.git
cd money-dashboard
mkdir -p data && cp html/data.example.json data/data.json   # remplis-le, ou génère-le via tools/
docker compose up -d --build                                # → http://localhost
```

Le **code** est buildé dans l'image (Dockerfile) ; le dashboard lit les **données** dans `data/`
(monté en volume, régénéré par les scripts `tools/`). Le format est documenté dans `html/data.example.json`.

---

## 🔒 Vie privée

Ce dépôt est **public mais ne contient aucune donnée financière réelle**. Sont **gitignorés** :
`data/` (toutes les données générées), `tools/prices.json`, `tools/price_history.json`, `tools/sources/`, topic ntfy…
Seuls le **code** et des **exemples anonymisés** sont publiés. Les captures ci-dessus utilisent un jeu de données **fictif**.

---

## 📜 Disclaimer

Projet **personnel**, à but d'apprentissage. **Aucun conseil en investissement.** Les performances passées ne préjugent pas des performances futures.

---

<div align="center">

Fait avec 🔥 par **Luku** — [GitHub](https://github.com/LukuLaMule) · [Instagram](https://instagram.com/luku_la_mule)

⭐ *Si ça te plaît, lâche une étoile !*

</div>
