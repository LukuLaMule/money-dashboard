#!/usr/bin/env python3
"""
tr_to_data.py — convertit les exports du trade_republic_scraper en data.json
pour le dashboard money.luku.fr.

Sources (dans /home/opc/tr_scraper/out/ par défaut) :
  - trade_republic_transactions.json  → dividendes + courbe d'investi (coût d'acquisition)
  - trade_republic_portfolio.json     → positions exactes (parts + PRU)   [compactPortfolio]
  - prices.json (optionnel)           → cours actuels par ISIN ou ticker  → valo + +/- value

Calculs :
  - L'ISIN est extrait du champ `icon` ("logos/<ISIN>/v2").
  - Montants : on utilise amount.value (numérique signé), pas les libellés FR.
  - Investi = somme cumulée de -amount.value sur les opérations de bourse
    (achat = montant négatif → +investi ; vente = positif → -investi).
  - Dividendes = SSP_CORPORATE_ACTION_CASH (subtitle "Dividende"), montant net crédité.

Usage :
  python3 tr_to_data.py --account cto \
      --transactions /home/opc/tr_scraper/out/trade_republic_transactions.json \
      --portfolio    /home/opc/tr_scraper/out/trade_republic_portfolio.json \
      --prices       /home/opc/Docker/sites/money/tools/prices.json \
      --out          /home/opc/Docker/sites/money/html/data.json \
      --merge        # conserve les autres comptes déjà présents dans data.json
"""
import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import date

ISIN_RE = re.compile(r"logos/([A-Za-z0-9]{12})/")

# Opérations de bourse qui constituent le coût d'acquisition / les parts.
TRADE_EVENTS = {
    "TRADING_SAVINGSPLAN_EXECUTED", "SAVINGS_PLAN_EXECUTED", "SAVINGS_PLAN_INVOICE_CREATED",
    "TRADE_INVOICE", "TRADING_TRADE_EXECUTED", "ORDER_EXECUTED",
    "PRIVATE_MARKET_FUND_TRADE_EXECUTED",
}
DIVIDEND_EVENTS = {"SSP_CORPORATE_ACTION_CASH"}

# Flux de trésorerie externes = "apports" réellement laissés pour investir.
# amount.value est signé : dépôts positifs, retraits/dépenses carte négatifs.
CASHFLOW_EVENTS = {
    "PAYMENT_INBOUND_APPLE_PAY", "BANK_TRANSACTION_INCOMING", "CREDIT",
    "BANK_TRANSACTION_OUTGOING", "CARD_TRANSACTION",
}

ACCOUNT_LABELS = {
    "cto": ("CTO", "Trade Republic", "#00e5ff"),
    "pea": ("PEA", "Bourse Direct", "#39ff14"),
}


def get_isin(tx):
    m = ISIN_RE.search(tx.get("icon") or "")
    return m.group(1) if m else None


def amount(tx):
    a = tx.get("amount") or {}
    return float(a.get("value") or 0.0)


def month_key(ts):
    # "2026-03-12T08:46:53.629+0000" -> "2026-03-01"
    return ts[:7] + "-01"


def ticker_from_title(title):
    if not title:
        return "?"
    t = title.strip().upper()
    return re.sub(r"[^A-Z0-9]+", "", t)[:6] or t[:6]


def build_dividends(txs, account):
    out = []
    for tx in txs:
        if tx.get("eventType") not in DIVIDEND_EVENTS:
            continue
        amt = amount(tx)
        sub = (tx.get("subtitle") or "")
        if amt <= 0 or "ividend" not in sub:
            continue
        out.append({
            "date": tx["timestamp"][:10],
            "account": account,
            "isin": get_isin(tx),
            "ticker": ticker_from_title(tx.get("title")),
            "label": tx.get("title") or "?",
            "amount": round(amt, 2),
        })
    out.sort(key=lambda d: d["date"])
    return out


def build_invested_curve(txs, account):
    """Courbe mensuelle de l'investi cumulé = apports nets (dépôts - retraits - carte)."""
    by_month = defaultdict(float)
    for tx in txs:
        if tx.get("eventType") not in CASHFLOW_EVENTS:
            continue
        by_month[month_key(tx["timestamp"])] += amount(tx)  # signé : in(+) / out(-)
    if not by_month:
        return []
    months = sorted(by_month)
    # remplissage continu du 1er mois à aujourd'hui, investi cumulé reporté
    start = date.fromisoformat(months[0])
    today = date.today()
    snaps, cum = [], 0.0
    y, m = start.year, start.month
    while (y, m) <= (today.year, today.month):
        key = f"{y:04d}-{m:02d}-01"
        cum += by_month.get(key, 0.0)
        snaps.append({"date": key, "account": account,
                      "invested": round(cum, 2), "value": None})
        m += 1
        if m > 12:
            m = 1; y += 1
    return snaps


def read_pytr_csv(path):
    """Lit le CSV `pytr portfolio` → structure {positions:[...]} (case-insensitive)."""
    rows = list(csv.DictReader(open(path, encoding="utf-8-sig"), delimiter=";")) or []
    if rows and len(rows[0]) <= 1:  # mauvais séparateur → réessaie en virgule
        rows = list(csv.DictReader(open(path, encoding="utf-8-sig")))
    def col(d, *keys):
        for k in d:
            kl = k.lower().replace(" ", "")
            if any(kk in kl for kk in keys):
                return d[k]
        return None
    def fnum(s):
        if not s:
            return 0.0
        s = str(s).replace("\xa0", "").replace(" ", "").replace(",", ".").replace("€", "")
        try:
            return float(s)
        except ValueError:
            return 0.0
    positions = []
    for r in rows:
        positions.append({
            "isin": (col(r, "isin") or "").strip(),
            "netSize": fnum(col(r, "quantity", "qty", "netsize", "shares")),
            "averageBuyIn": fnum(col(r, "avgcost", "averagebuy", "buyin", "pru")),
            "_last": fnum(col(r, "price", "cours")) or None,
            "_name": (col(r, "name", "nom") or "").strip() or None,
        })
    return {"positions": positions}


def build_positions(portfolio, txs, account, prices):
    """Positions exactes depuis compactPortfolio/pytr + noms timeline + cours."""
    if not portfolio:
        return [], None
    names = {}
    for tx in txs:
        i = get_isin(tx)
        if i and i not in names and tx.get("title"):
            names[i] = tx["title"]

    raw = portfolio.get("positions") or portfolio.get("compactPortfolioPositions") or []
    positions, total_value = [], 0.0
    have_any_price = False
    for p in raw:
        isin = p.get("instrumentId") or p.get("isin") or p.get("instrument")
        shares = float(p.get("netSize") or p.get("size") or p.get("quantity") or 0)
        pru = float(p.get("averageBuyIn") or p.get("buyIn") or p.get("averagePrice") or 0)
        if not isin or shares == 0:
            continue
        label = names.get(isin) or p.get("_name") or isin
        tk = ticker_from_title(label)
        last = p.get("_last")  # cours fourni directement par pytr
        if last is None and prices:
            last = prices.get(isin) or prices.get(tk) or prices.get(label)
        if last is None:
            last = pru  # repli : valo = coût tant qu'aucun cours fourni
        else:
            have_any_price = True
            last = float(last)
        positions.append({
            "account": account, "ticker": tk, "label": label, "isin": isin,
            "shares": round(shares, 6), "pru": round(pru, 4), "last": round(last, 4),
        })
        total_value += shares * last
    positions.sort(key=lambda x: -x["shares"] * x["last"])
    return positions, (round(total_value, 2) if have_any_price else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--account", default="cto")
    ap.add_argument("--transactions", required=True)
    ap.add_argument("--portfolio", default=None, help="JSON compactPortfolio")
    ap.add_argument("--portfolio-csv", default=None, help="CSV `pytr portfolio`")
    ap.add_argument("--prices", default=None)
    ap.add_argument("--current-value", type=float, default=None,
                    help="valeur totale actuelle du compte (autorité = app TR) si l'API ne sort pas les positions")
    ap.add_argument("--out", required=True)
    ap.add_argument("--merge", action="store_true",
                    help="conserve les autres comptes déjà présents dans --out")
    args = ap.parse_args()

    txs = json.load(open(args.transactions, encoding="utf-8"))
    if args.portfolio_csv:
        portfolio = read_pytr_csv(args.portfolio_csv)
    elif args.portfolio:
        portfolio = json.load(open(args.portfolio, encoding="utf-8"))
    else:
        portfolio = None
    prices = json.load(open(args.prices, encoding="utf-8")) if args.prices else None

    acc = args.account
    dividends = build_dividends(txs, acc)
    snapshots = build_invested_curve(txs, acc)
    positions, cur_value = build_positions(portfolio, txs, acc, prices)

    # valeur totale : override manuel (app TR) prioritaire, sinon valo reconstruite
    if args.current_value is not None:
        cur_value = round(args.current_value, 2)
    if snapshots and cur_value is not None:
        snapshots[-1]["value"] = cur_value

    label, broker, color = ACCOUNT_LABELS.get(acc, (acc.upper(), "", "#39ff14"))
    accounts = [{"id": acc, "label": label, "broker": broker, "color": color}]

    if args.merge:
        try:
            old = json.load(open(args.out, encoding="utf-8"))
            other = lambda lst: [r for r in lst if r.get("account") != acc]
            accounts = [a for a in old.get("accounts", []) if a.get("id") != acc] + accounts
            snapshots = other(old.get("snapshots", [])) + snapshots
            dividends = other(old.get("dividends", [])) + dividends
            positions = other(old.get("positions", [])) + positions
        except FileNotFoundError:
            pass

    data = {
        "currency": "EUR", "owner": "LUKU",
        "lastUpdate": date.today().isoformat(),
        "accounts": accounts,
        "snapshots": snapshots,
        "dividends": dividends,
        "positions": positions,
    }
    json.dump(data, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    inv = snapshots[-1]["invested"] if snapshots else 0
    div = sum(d["amount"] for d in dividends)
    print(f"✅ {args.out}")
    print(f"   compte {acc} : {len(snapshots)} mois | investi cumulé {inv:.2f} € | "
          f"{len(dividends)} dividendes ({div:.2f} €) | {len(positions)} positions"
          + (f" | valo {cur_value:.2f} €" if cur_value else " | valo: prices.json manquant"))
    if positions and cur_value is None:
        print("   ⚠️ Aucun cours fourni → remplis tools/prices.json (ISIN: cours) pour la valo & les +/- value.")


if __name__ == "__main__":
    main()
