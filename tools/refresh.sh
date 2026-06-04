#!/usr/bin/env bash
# refresh.sh — régénère les données du dashboard money.luku.fr.
#   news   : actus Yahoo (rapide, indépendant)
#   prices : cours intraday seulement (rapide), reconstruit data.json — pour cron fréquent
#   full   : cours + historique Yahoo, puis reconstruit data.json depuis les sources
# Usage : refresh.sh [news|prices|full]   (défaut: full)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # tools/
ROOT="$(dirname "$DIR")"                                  # projet
PY="python3.11"
HTML="$ROOT/data"   # JSON dynamiques (volume /srv/data du conteneur, hors image)
MODE="${1:-full}"

cd "$DIR"

# --- News (sauf en mode prices, où on veut rester rapide) ---
if [ "$MODE" != "prices" ]; then
  $PY fetch_news.py --out "$HTML/news.json" || echo "news: échec (non bloquant)"
fi

if [ "$MODE" = "news" ]; then exit 0; fi

# --- Cours + historique (Yahoo) à partir des ISIN connus de data.json + des sources ---
if [ "$MODE" = "prices" ]; then
  # intraday : cours actuels seulement (range court, l'historique mensuel est fusionné, pas perdu)
  $PY fetch_prices.py --data "$HTML/data.json" --range 5d || echo "prices: échec (non bloquant)"
else
  $PY fetch_prices.py --data "$HTML/data.json" --range 5y || echo "prices: échec (non bloquant)"
  $PY fetch_benchmarks.py || echo "benchmarks: échec (non bloquant)"
fi

# --- Reconstruit le PEA depuis l'avis d'opéré stocké ---
if [ -f "$DIR/sources/pea_avis_opere.csv" ]; then
  $PY bourse_direct_to_data.py \
    --csv "$DIR/sources/pea_avis_opere.csv" \
    --prices "$DIR/prices.json" --history "$DIR/price_history.json" \
    --out "$HTML/data.json" --merge
fi

# --- CTO Trade Republic ---
TR_DIR="/home/opc/tr_scraper"
TR_TX="$TR_DIR/out/trade_republic_transactions.json"
TR_V2="$TR_DIR/out/cto_portfolio_v2.json"
# tente de rafraîchir le portefeuille V2 (reprise de session, sans 2FA ; échoue vite si expirée)
# (sauté en mode prices : on réutilise le dernier portefeuille, seuls les cours Yahoo changent)
if [ "$MODE" != "prices" ]; then
  ( cd "$TR_DIR" && timeout 45 .venv/bin/python fetch_tr_portfolio.py < /dev/null ) || echo "cto V2: session TR expirée → garde le dernier portefeuille (relance cto_relogin.sh)"
fi
CASH=$($PY -c "import json;print(json.load(open('$TR_DIR/out/trade_republic_profile_cash.json'))[0]['amount'])" 2>/dev/null || echo 0)
if [ -f "$TR_TX" ]; then
  ARGS="--transactions $TR_TX --out $HTML/data.json --merge --prices $DIR/prices.json --cash $CASH"
  if [ -f "$TR_V2" ]; then ARGS="$ARGS --portfolio-v2 $TR_V2"
  elif [ -f "$DIR/cto_positions.json" ]; then ARGS="$ARGS --positions-file $DIR/cto_positions.json"; fi
  $PY tr_to_data.py --account cto $ARGS || echo "cto: échec (non bloquant)"
fi

# --- Enregistre la valo courante (intraday/daily) + horodatage fraîcheur ---
$PY record_value.py || echo "record_value: échec (non bloquant)"

echo "✅ refresh ($MODE) terminé : $(date)"
