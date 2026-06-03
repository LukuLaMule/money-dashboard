# money.luku.fr — Dashboard boursier PEA / CTO (read-only)

Site statique servi par nginx derrière Traefik (réseau `web`, SSL Let's Encrypt auto).
Tout le dashboard est piloté par un seul fichier : **`html/data.json`**.
Aucune écriture côté visiteur — 100 % read-only (nginx bloque tout sauf GET/HEAD).

## Démarrer / mettre à jour

```bash
cd /home/opc/Docker/sites/money
docker compose up -d        # démarre (ou recrée) le conteneur
# après modif de data.json : rien à rebuild, c'est servi en live (no-cache)
```

## Format de `data.json`

```jsonc
{
  "currency": "EUR",
  "owner": "LUKU",
  "lastUpdate": "2026-06-01",        // date affichée en bas

  "accounts": [                       // tes enveloppes
    { "id": "pea", "label": "PEA", "broker": "Bourse Direct", "color": "#39ff14" },
    { "id": "cto", "label": "CTO", "broker": "Trade Republic", "color": "#00e5ff" }
  ],

  // 1 ligne = la photo d'un compte à une date donnée (idéalement 1x/mois)
  // value = valeur de marché totale du compte ce jour-là
  // invested = total des apports nets (ce que t'as mis de ta poche)
  "snapshots": [
    { "date": "2025-01-01", "account": "pea", "value": 10250, "invested": 10000 }
  ],

  // chaque dividende encaissé
  "dividends": [
    { "date": "2025-03-12", "account": "cto", "ticker": "TTE", "label": "TotalEnergies", "amount": 38.40 }
  ],

  // tes positions actuelles (calcul auto valeur & +/- value)
  // pru = prix de revient unitaire ; last = cours actuel
  "positions": [
    { "account": "pea", "ticker": "CW8", "label": "Amundi MSCI World", "shares": 22, "pru": 405.10, "last": 512.40 }
  ]
}
```

### Ce dont j'ai besoin de ta part pour brancher tes vrais chiffres
- **Snapshots** : pour chaque compte, l'historique `date / value / invested`. Un point par mois suffit (export courbe de ton courtier, ou relevés). Plus t'en donnes, plus la courbe de performance est belle.
- **Dividendes** : la liste `date / compte / ticker / montant`.
- **Positions actuelles** : `compte / ticker / nom / quantité / PRU / cours actuel`.

Format libre au départ (CSV, copier-coller, capture lisible, export Finary/courtier) — je convertis en `data.json`.

## Stack
- nginx (statique) + Chart.js 4 (CDN) — aucune base de données.
- Animations : skill **transitions.dev** (number pop-in, tabs sliding, shimmer).
- Thème : MLG montage parody (hitmarkers, airhorn WebAudio, pluie Doritos/Mountain Dew).

## Données (repo public)
Les fichiers de données réelles sont **gitignorés** (non publiés) : `html/data.json`,
`tools/prices.json`, `tools/price_history.json`, `tools/cto_positions.json`, `tools/sources/`…
Pour faire tourner le dashboard : `cp html/data.example.json html/data.json` puis remplis-le
(ou génère-le via les scripts `tools/`). Voir `tools/cto_positions.example.json` pour le CTO.
