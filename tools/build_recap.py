#!/usr/bin/env python3
"""
build_recap.py — récap du mois écoulé → html/recap.json (cron le 1er du mois).

Calcule, tous comptes confondus :
  - perf du mois hors apports (valeur fin de mois vs fin du mois précédent, net des apports)
  - dividendes encaissés dans le mois
  - top/flop 3 des positions détenues (variation mensuelle du cours, via price_history.json)

Valeurs de début/fin de mois : daily.json (granularité jour) si dispo, sinon les
snapshots mensuels (datés au 1er du mois = valo de fin du mois précédent).

Usage : build_recap.py [--month YYYY-MM]   (défaut : le mois précédent)
"""
import argparse
import json
import os
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
HTML = os.path.join(os.path.dirname(HERE), "data")  # JSON dynamiques (volume, hors image)
MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin",
             "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
MONTHS_FR_ABBR = ["janv.", "févr.", "mars", "avr.", "mai", "juin",
                  "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def load(path):
    return json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}


def month_add(ym, n):
    y, m = int(ym[:4]), int(ym[5:7])
    m += n
    y += (m - 1) // 12
    m = (m - 1) % 12 + 1
    return f"{y:04d}-{m:02d}"


def value_at_month_end(ym, daily, snapshots):
    """Valo totale en fin de mois ym : dernier point daily du mois, sinon snapshot du 1er du mois suivant."""
    days = sorted(d for d in daily if d.startswith(ym))
    if days:
        return round(sum(v["v"] for v in daily[days[-1]].values()), 2)
    nxt = month_add(ym, 1) + "-01"
    rows = [s for s in snapshots if s["date"] == nxt and s.get("value") is not None]
    return round(sum(s["value"] for s in rows), 2) if rows else None


def invested_at_month_end(ym, daily, snapshots):
    days = sorted(d for d in daily if d.startswith(ym))
    if days:
        return round(sum(v["i"] for v in daily[days[-1]].values()), 2)
    nxt = month_add(ym, 1) + "-01"
    rows = [s for s in snapshots if s["date"] == nxt and s.get("invested") is not None]
    return round(sum(s["invested"] for s in rows), 2) if rows else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--month", default=None, help="YYYY-MM (défaut : mois précédent)")
    args = ap.parse_args()

    today = date.today()
    ym = args.month or month_add(f"{today.year:04d}-{today.month:02d}", -1)
    prev = month_add(ym, -1)

    data = load(os.path.join(HTML, "data.json"))
    daily = load(os.path.join(HTML, "daily.json"))
    history = load(os.path.join(HERE, "price_history.json"))
    snapshots = data.get("snapshots", [])

    start = value_at_month_end(prev, daily, snapshots)
    end = value_at_month_end(ym, daily, snapshots)
    inv_start = invested_at_month_end(prev, daily, snapshots)
    inv_end = invested_at_month_end(ym, daily, snapshots)
    if start is None or end is None:
        print(f"recap {ym}: valeurs de début/fin introuvables — abandon")
        return
    contrib = round((inv_end or 0) - (inv_start or 0), 2)
    gain = round(end - start - contrib, 2)
    base = start + max(0, contrib)
    gain_pct = round(gain / base * 100, 2) if base else 0.0

    dividends = round(sum(d["amount"] for d in data.get("dividends", [])
                          if d.get("date", "").startswith(ym)), 2)

    # top/flop : variation mensuelle du cours des positions détenues
    movers = []
    for p in data.get("positions", []):
        h = history.get(p.get("isin") or "", {})
        a, b = h.get(prev + "-01"), h.get(ym + "-01")
        if a and b:
            movers.append({"t": p.get("ticker", "?"), "label": p.get("label", ""),
                           "pct": round((b / a - 1) * 100, 2)})
    movers.sort(key=lambda x: x["pct"], reverse=True)
    seen, uniq = set(), []
    for m in movers:  # dédoublonne (un ISIN peut apparaître 2×)
        if m["t"] not in seen:
            seen.add(m["t"]); uniq.append(m)

    # comparatif : perf hors apports des 6 derniers mois (dont le mois du récap)
    months_hist = []
    for i in range(5, -1, -1):
        m = month_add(ym, -i)
        s_v = value_at_month_end(month_add(m, -1), daily, snapshots)
        e_v = value_at_month_end(m, daily, snapshots)
        s_i = invested_at_month_end(month_add(m, -1), daily, snapshots)
        e_i = invested_at_month_end(m, daily, snapshots)
        if s_v is None or e_v is None:
            continue
        c = (e_i or 0) - (s_i or 0)
        g = e_v - s_v - c
        b = s_v + max(0, c)
        months_hist.append({"m": m, "label": MONTHS_FR_ABBR[int(m[5:7]) - 1],
                            "pct": round(g / b * 100, 2) if b else 0.0})

    recap = {
        "month": ym,
        "label": f"{MONTHS_FR[int(ym[5:7]) - 1]} {ym[:4]}",
        "start_value": start, "end_value": end, "contrib": contrib,
        "gain": gain, "gain_pct": gain_pct, "dividends": dividends,
        "top": uniq[:3], "flop": [m for m in reversed(uniq[-3:]) if m["pct"] < 0],
        "months": months_hist,
    }
    out = os.path.join(HTML, "recap.json")
    json.dump(recap, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"✅ {out} — {recap['label']} : {gain:+.2f} € ({gain_pct:+.2f} %), div {dividends:.2f} €")


if __name__ == "__main__":
    main()
