#!/usr/bin/env bash
# Keep-alive CTO : reprend la session TR (sans 2FA) et rafraîchit le portefeuille.
# Lancé souvent par cron pour garder la session vivante. Si elle a expiré → ne fait
# rien (non bloquant) ; relancer alors cto_relogin.sh (2FA) une fois.
set -uo pipefail
DIR="/home/opc/Docker/sites/money/tools"
HTML="/home/opc/Docker/sites/money/data"  # JSON dynamiques (volume, hors image)
TR="/home/opc/tr_scraper"

cd "$TR" && timeout 50 .venv/bin/python fetch_tr_portfolio.py < /dev/null || { echo "$(date) session TR expirée — relancer cto_relogin.sh"; exit 0; }

CASH=$(python3.11 -c "import json;print(json.load(open('$TR/out/trade_republic_profile_cash.json'))[0]['amount'])" 2>/dev/null || echo 0)
python3.11 "$DIR/tr_to_data.py" --account cto \
  --transactions "$TR/out/trade_republic_transactions.json" \
  --portfolio-v2 "$TR/out/cto_portfolio_v2.json" \
  --prices "$DIR/prices.json" --cash "$CASH" \
  --out "$HTML/data.json" --merge
echo "$(date) CTO rafraîchi"
