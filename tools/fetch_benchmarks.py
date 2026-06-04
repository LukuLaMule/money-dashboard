#!/usr/bin/env python3
"""fetch_benchmarks.py — historique mensuel EUR d'indices de référence (Yahoo) → benchmarks.json."""
import json
import os
from fetch_prices import chart, to_eur

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "data", "benchmarks.json")
BENCH = {"CAC 40": "^FCHI", "S&P 500": "^GSPC", "MSCI World": "EWLD.PA"}


def main():
    out = {}
    for name, sym in BENCH.items():
        try:
            _, cur, series = chart(sym, "5y")
            out[name] = {m: round(to_eur(v, cur, m, "5y"), 4) for m, v in series.items()}
            print(f"{name} ({sym}) : {len(out[name])} mois [{cur}]")
        except Exception as e:
            print(f"{name} ({sym}) : ⚠️ {e}")
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"✅ {OUT}")


if __name__ == "__main__":
    main()
