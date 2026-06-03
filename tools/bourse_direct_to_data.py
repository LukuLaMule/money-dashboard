#!/usr/bin/env python3
"""
bourse_direct_to_data.py — convertit l'avis d'opéré CSV de Bourse Direct (PEA)
en data.json pour le dashboard money.luku.fr.

Le CSV "Avis d'opéré" contient ISIN + QUANTITE + COURS + Débit/Crédit par ligne,
ce qui permet de calculer positions, PRU (coût moyen) et apports de façon exacte.

Calculs :
  - Apports (investi) = INVESTISSEMENT ESPECES (crédits), cumulés par mois.
  - Dividendes        = COUPONS (crédits).
  - Positions         = ACHAT/VENTE COMPTANT agrégés par ISIN (méthode du coût moyen).
                        PRU = coût total restant / quantité ; vente réduit au coût moyen.
  - INDEMNISATION d'un ISIN (faillite/rachat, ex. ATOS) → position soldée à 0.
  - Cours actuels via tools/prices.json (optionnel) → valo + +/- value.

Usage :
  python3 bourse_direct_to_data.py \
      --csv "Avis_opere_...PEA.csv" \
      --prices /home/opc/Docker/sites/money/tools/prices.json \
      --out /home/opc/Docker/sites/money/html/data.json \
      --merge
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
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def ticker_from_name(name):
    t = re.sub(r"[^A-Za-z0-9]+", "", (name or "").upper())
    return t[:6] or "?"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--prices", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(args.csv, encoding="utf-8-sig")))
    prices = json.load(open(args.prices, encoding="utf-8")) if args.prices else None

    deposits_by_month = defaultdict(float)
    dividends = []
    # positions par ISIN : coût moyen
    pos = defaultdict(lambda: {"shares": 0.0, "cost": 0.0, "name": None})
    indemnified = set()

    for r in rows:
        desig = (r.get("Désignation") or "").strip().upper()
        titre = (r.get("Titre") or "").strip()
        isin = (r.get("ISIN") or "").strip()
        credit = num(r.get("Crédit (€)"))
        debit = num(r.get("Débit (€)"))
        qte = num(r.get("QUANTITE"))
        d_iso = to_iso(r["Date"]) if r.get("Date") else None

        if desig.startswith("INVESTISSEMENT ESPECES"):
            deposits_by_month[d_iso[:7] + "-01"] += credit
        elif desig.startswith("COUPONS"):
            dividends.append({
                "date": d_iso, "account": ACCOUNT,
                "ticker": ticker_from_name(titre), "label": titre or isin,
                "amount": round(credit, 2),
            })
        elif desig.startswith("ACHAT COMPTANT") and isin:
            p = pos[isin]; p["name"] = p["name"] or titre
            p["shares"] += qte
            p["cost"] += debit  # débit = brut + courtage
        elif desig.startswith("VENTE COMPTANT") and isin:
            p = pos[isin]; p["name"] = p["name"] or titre
            sold = abs(qte)
            avg = p["cost"] / p["shares"] if p["shares"] else 0.0
            p["shares"] -= sold
            p["cost"] -= sold * avg
        elif desig.startswith("INDEMNISATION") and isin:
            indemnified.add(isin)

    for isin in indemnified:
        if isin in pos:
            pos[isin]["shares"] = 0.0
            pos[isin]["cost"] = 0.0

    # positions courantes (parts > epsilon)
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
        positions.append({
            "account": ACCOUNT, "ticker": tk, "label": p["name"] or isin, "isin": isin,
            "shares": round(p["shares"], 6), "pru": round(pru, 4), "last": round(last, 4),
        })
    have_prices = bool(prices) and any(
        (prices.get(p["isin"]) or prices.get(p["ticker"]) or prices.get(p["label"])) is not None
        for p in positions
    )
    positions.sort(key=lambda x: -x["shares"] * x["last"])
    cur_value = round(sum(p["shares"] * p["last"] for p in positions), 2) if have_prices else None

    # courbe d'apports cumulés, du 1er mois à aujourd'hui
    snapshots = []
    if deposits_by_month:
        months = sorted(deposits_by_month)
        start = date.fromisoformat(months[0]); today = date.today()
        y, m, cum = start.year, start.month, 0.0
        while (y, m) <= (today.year, today.month):
            key = f"{y:04d}-{m:02d}-01"
            cum += deposits_by_month.get(key, 0.0)
            snapshots.append({"date": key, "account": ACCOUNT,
                              "invested": round(cum, 2), "value": None})
            m += 1
            if m > 12:
                m = 1; y += 1
    if snapshots and cur_value is not None:
        snapshots[-1]["value"] = cur_value

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

    data = {
        "currency": "EUR", "owner": "LUKU", "lastUpdate": date.today().isoformat(),
        "accounts": accounts, "snapshots": snapshots,
        "dividends": dividends, "positions": positions,
    }
    json.dump(data, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    inv = snapshots[-1]["invested"] if snapshots else 0
    div = sum(d["amount"] for d in dividends if d["account"] == ACCOUNT)
    print(f"✅ {args.out}")
    print(f"   PEA : apports cumulés {inv:.2f} € | {len([d for d in dividends if d['account']==ACCOUNT])} coupons ({div:.2f} €) | "
          f"{len([p for p in positions if p['account']==ACCOUNT])} positions"
          + (f" | valo {cur_value:.2f} €" if cur_value else " | valo: prices.json manquant"))
    print("\n   Positions PEA :")
    for p in positions:
        if p["account"] == ACCOUNT:
            print(f"     {p['label'][:24]:24s} {p['shares']:>9.4f} parts  PRU {p['pru']:>8.3f} €  (ISIN {p['isin']})")


if __name__ == "__main__":
    main()
