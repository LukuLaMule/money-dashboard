#!/usr/bin/env bash
# refresh.sh — régénère les données du dashboard money.luku.fr.
#   news  : actus Yahoo (rapide, indépendant)
#   full  : cours + historique Yahoo, puis reconstruit data.json depuis les sources
# Usage : refresh.sh [news|full]   (défaut: full)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"      # tools/
ROOT="$(dirname "$DIR")"                                  # projet
PY="python3.11"
HTML="$ROOT/html"
MODE="${1:-full}"

cd "$DIR"

# --- News (toujours) ---
$PY fetch_news.py --out "$HTML/news.json" || echo "news: échec (non bloquant)"

if [ "$MODE" = "news" ]; then exit 0; fi

# --- Cours + historique (Yahoo) à partir des ISIN connus de data.json + des sources ---
$PY fetch_prices.py --data "$HTML/data.json" --range 5y || echo "prices: échec (non bloquant)"
$PY fetch_benchmarks.py || echo "benchmarks: échec (non bloquant)"

# --- Reconstruit le PEA depuis l'avis d'opéré stocké ---
if [ -f "$DIR/sources/pea_avis_opere.csv" ]; then
  $PY bourse_direct_to_data.py \
    --csv "$DIR/sources/pea_avis_opere.csv" \
    --prices "$DIR/prices.json" --history "$DIR/price_history.json" \
    --out "$HTML/data.json" --merge
fi

# --- Reconstruit le CTO si l'export Trade Republic est présent ---
TR_TX="/home/opc/tr_scraper/out/trade_republic_transactions.json"
TR_PF_JSON="/home/opc/tr_scraper/out/trade_republic_portfolio.json"
TR_PF_CSV="/home/opc/tr_scraper/out/trade_republic_portfolio.csv"
if [ -f "$TR_TX" ]; then
  ARGS="--transactions $TR_TX --out $HTML/data.json --merge --prices $DIR/prices.json"
  if [ -f "$DIR/cto_positions.json" ]; then ARGS="$ARGS --positions-file $DIR/cto_positions.json"
  elif [ -f "$TR_PF_CSV" ] && [ "$(wc -l < "$TR_PF_CSV")" -gt 1 ]; then ARGS="$ARGS --portfolio-csv $TR_PF_CSV"
  elif [ -f "$TR_PF_JSON" ]; then ARGS="$ARGS --portfolio $TR_PF_JSON"
  elif [ -f "$DIR/cto_value.txt" ]; then ARGS="$ARGS --current-value $(cat "$DIR/cto_value.txt")"; fi
  $PY tr_to_data.py --account cto $ARGS || echo "cto: échec (non bloquant)"
fi

echo "✅ refresh ($MODE) terminé : $(date)"
