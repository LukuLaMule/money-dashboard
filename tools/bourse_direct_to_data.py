#!/usr/bin/env python3
"""
bourse_direct_to_data.py — convertit l'avis d'opéré CSV de Bourse Direct (PEA)
en data.json pour le dashboard money.luku.fr.

Le CSV "Avis d'opéré" contient ISIN + QUANTITE + COURS + Débit/Crédit par ligne.

Calculs :
  - Apports (investi)  = INVESTISSEMENT ESPECES (crédits), cumulés par mois.
  - Dividendes         = COUPONS (crédits).
  - Positions actuelles = ACHAT/VENTE COMPTANT agrégés par ISIN (coût moyen → PRU).
                          INDEMNISATION d'un ISIN (ex. ATOS) → position soldée à 0.
  - Courbe de VALEUR (si --history fourni) = pour chaque mois :
        Σ (parts détenues ce mois × cours de l'époque)  +  cash du compte ce mois.
    → reconstruit l'évolution réelle au lieu d'un seul point « pic » à aujourd'hui.
  - Cours actuels via --prices (prices.json) pour la valo du dernier point.

Usage :
  python3.11 bourse_direct_to_data.py --csv "Avis...PEA.csv" \
      --prices tools/prices.json --history tools/price_history.json \
      --out html/data.json --merge
"""
import argparse
import csv
import json
import re
from collections import defaultdict
from datetime import date

ACCOUNT = "pea"


def to_iso(d):
    dd, mm, yy = d.split("/")
    return f"{yy}-{mm}-{dd}"


def num(s):
    if s is None:
        return 0.0
    s = s.strip().replace("\xa0", "").replace(" ", "").replace(",", ".")
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def ticker_from_name(name):
    t = re.sub(r"[^A-Za-z0-9]+", "", (name or "").upper())
    return t[:6] or "?"


def month_iter(start_iso, end_date):
    y, m = int(start_iso[:4]), int(start_iso[5:7])
    while (y, m) <= (end_date.year, end_date.month):
        yield f"{y:04d}-{m:02d}-01"
        m += 1
        if m > 12:
            m = 1; y += 1


def price_at(series, month):
    """Dernier cours connu ≤ month dans {mois: cours}."""
    if not series:
        return None
    keys = [k for k in series if k <= month]
    if keys:
        return series[max(keys)]
    return series[min(series)]  # avant le 1er cours connu : 1er dispo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--prices", default=None)
    ap.add_argument("--history", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.csv, encoding="utf-8-sig")))
    prices = json.load(open(args.prices, encoding="utf-8")) if args.prices else None
    history = json.load(open(args.history, encoding="utf-8")) if args.history else None

    deposits_by_month = defaultdict(float)
    cash_by_month = defaultdict(float)      # tous flux (crédit - débit) → solde espèces
    dividends = []
    share_events = []                        # (iso_date, isin, dshares)
    indemn_events = []                       # (iso_date, isin) → solde à 0
    pos = defaultdict(lambda: {"shares": 0.0, "cost": 0.0, "name": None})
    buy_qty = defaultdict(float)             # pour le prix d'achat de référence (anti-split)
    buy_cost = defaultdict(float)
    names = {}

    for r in rows:
        desig = (r.get("Désignation") or "").strip().upper()
        titre = (r.get("Titre") or "").strip()
        isin = (r.get("ISIN") or "").strip()
        credit = num(r.get("Crédit (€)"))
        debit = num(r.get("Débit (€)"))
        qte = num(r.get("QUANTITE"))
        d_iso = to_iso(r["Date"]) if r.get("Date") else None
        mk = d_iso[:7] + "-01"
        cash_by_month[mk] += credit - debit
        if isin and titre:
            names.setdefault(isin, titre)

        if desig.startswith("INVESTISSEMENT ESPECES"):
            deposits_by_month[mk] += credit
        elif desig.startswith("COUPONS"):
            dividends.append({"date": d_iso, "account": ACCOUNT, "isin": isin,
                              "ticker": ticker_from_name(titre), "label": titre or isin,
                              "amount": round(credit, 2)})
        elif desig.startswith("ACHAT COMPTANT") and isin:
            p = pos[isin]; p["name"] = p["name"] or titre
            p["shares"] += qte; p["cost"] += debit
            buy_qty[isin] += qte; buy_cost[isin] += debit
            share_events.append((d_iso, isin, qte))
        elif desig.startswith("VENTE COMPTANT") and isin:
            p = pos[isin]; p["name"] = p["name"] or titre
            sold = abs(qte)
            avg = p["cost"] / p["shares"] if p["shares"] else 0.0
            p["shares"] -= sold; p["cost"] -= sold * avg
            share_events.append((d_iso, isin, -sold))
        elif desig.startswith("INDEMNISATION") and isin:
            indemn_events.append((d_iso, isin))

    for d_iso, isin in indemn_events:
        if isin in pos:
            pos[isin]["shares"] = 0.0; pos[isin]["cost"] = 0.0

    # --- positions actuelles (table) ---
    positions = []
    for isin, p in pos.items():
        if p["shares"] < 1e-6:
            continue
        pru = p["cost"] / p["shares"]
        tk = ticker_from_name(p["name"])
        last = None
        if prices:
            last = prices.get(isin) or prices.get(tk) or prices.get(p["name"])
        last = float(last) if last is not None else round(pru, 4)
        positions.append({"account": ACCOUNT, "ticker": tk, "label": p["name"] or isin,
                          "isin": isin, "shares": round(p["shares"], 6),
                          "pru": round(pru, 4), "last": round(last, 4)})
    have_prices = bool(prices) and any(
        (prices.get(p["isin"]) or prices.get(p["ticker"]) or prices.get(p["label"])) is not None
        for p in positions)
    positions.sort(key=lambda x: -x["shares"] * x["last"])
    cur_value = round(sum(p["shares"] * p["last"] for p in positions), 2) if have_prices else None

    # --- courbe (apports + valeur) ---
    snapshots = []
    all_months = sorted(set(deposits_by_month) | set(cash_by_month))
    if all_months:
        start = all_months[0]
        cum_dep = 0.0
        cum_cash = 0.0
        # parts détenues par ISIN au fil des mois
        for month in month_iter(start, date.today()):
            cum_dep += deposits_by_month.get(month, 0.0)
            cum_cash += cash_by_month.get(month, 0.0)
            value = None
            if history:
                # holdings à la fin de ce mois
                held = defaultdict(float)
                for d_iso, isin, ds in share_events:
                    if d_iso[:7] <= month[:7]:
                        held[isin] += ds
                for d_iso, isin in indemn_events:
                    if d_iso[:7] <= month[:7]:
                        held[isin] = 0.0
                sec = 0.0
                for isin, sh in held.items():
                    if sh < 1e-6:
                        continue
                    pr = price_at(history.get(isin, {}), month)
                    if pr is None and prices:
                        pr = prices.get(isin)
                    # garde-fou anti-split : si le cours s'écarte aberramment du
                    # prix d'achat de référence (ex. ATOS reverse-split), on retombe dessus
                    ref = (buy_cost[isin] / buy_qty[isin]) if buy_qty.get(isin) else None
                    if pr and ref and (pr > 4 * ref or pr < 0.25 * ref):
                        pr = ref
                    sec += sh * (pr or 0.0)
                value = round(sec + cum_cash, 2)
            snapshots.append({"date": month, "account": ACCOUNT,
                              "invested": round(cum_dep, 2), "value": value})
        # dernier point : valo via cours actuels si dispo
        if snapshots and cur_value is not None:
            snapshots[-1]["value"] = round(cur_value + cum_cash, 2)

    dividends.sort(key=lambda d: d["date"])
    accounts = [{"id": ACCOUNT, "label": "PEA", "broker": "Bourse Direct", "color": "#39ff14"}]

    if args.merge:
        try:
            old = json.load(open(args.out, encoding="utf-8"))
            keep = lambda lst: [r for r in lst if r.get("account") != ACCOUNT]
            accounts = [a for a in old.get("accounts", []) if a.get("id") != ACCOUNT] + accounts
            snapshots = keep(old.get("snapshots", [])) + snapshots
            dividends = keep(old.get("dividends", [])) + dividends
            positions = keep(old.get("positions", [])) + positions
        except FileNotFoundError:
            pass

    data = {"currency": "EUR", "owner": "LUKU", "lastUpdate": date.today().isoformat(),
            "accounts": accounts, "snapshots": snapshots,
            "dividends": dividends, "positions": positions}
    json.dump(data, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    inv = next((s["invested"] for s in reversed(snapshots) if s["account"] == ACCOUNT), 0)
    val = next((s["value"] for s in reversed(snapshots) if s["account"] == ACCOUNT and s["value"]), None)
    div = sum(d["amount"] for d in dividends if d["account"] == ACCOUNT)
    npos = len([p for p in positions if p["account"] == ACCOUNT])
    print(f"✅ {args.out}")
    print(f"   PEA : apports {inv:.0f} € | valo {val if val else '—'} € | "
          f"{len([d for d in dividends if d['account']==ACCOUNT])} coupons ({div:.0f} €) | {npos} positions")


if __name__ == "__main__":
    main()
