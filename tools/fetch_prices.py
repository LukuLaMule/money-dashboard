#!/usr/bin/env python3
"""
fetch_prices.py — récupère cours actuels + historique mensuel (en EUR) via Yahoo Finance.

- Résout chaque ISIN en symbole Yahoo (cache dans tools/symbols.json, surchargeable).
- Récupère l'historique mensuel + le cours actuel.
- Convertit en EUR si l'instrument cote dans une autre devise (USD/GBP/GBp) via le taux FX Yahoo.

Sorties :
  - tools/prices.json        : { ISIN: cours_actuel_EUR }
  - tools/price_history.json : { ISIN: { "YYYY-MM-01": close_EUR, ... } }

Usage :
  python3.11 fetch_prices.py --data /home/opc/Docker/sites/money/data/data.json
  python3.11 fetch_prices.py --isins LU2655993207,FR0000120073 --range 5y
"""
import argparse
import json
import os
import ssl
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
CTX = ssl.create_default_context()  # vérification TLS activée
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}

# Surcharges manuelles ISIN -> symbole Yahoo (si la résolution auto se trompe).
# Titres US du CTO : on cote sur les places allemandes (Stuttgart/Francfort, EUR natif,
# ouvertes 8h-22h Paris) au lieu du NYSE/NASDAQ — sinon la « variation du jour » reste
# figée sur la clôture US de la veille jusqu'à 15h30 Paris, alors que TR (LS Exchange)
# cote en continu. Bonus : plus de conversion FX.
SYMBOL_OVERRIDES = {
    "XF000BTC0017": "BTC-EUR",   # Bitcoin (TR)
    "US0420682058": "O9T.F",     # ARM Holdings ADR (Francfort)
    "US0079031078": "AMD.SG",    # AMD (Stuttgart)
    "US5949181045": "MSF.SG",    # Microsoft (Stuttgart)
    "US0937121079": "1ZB.SG",    # Bloom Energy (Stuttgart)
    "US36467W1099": "GS2C.F",    # GameStop (Francfort)
    "US5949724083": "MIGA.SG",   # MicroStrategy / Strategy Inc (Stuttgart)
    # US0846701086 Berkshire A → déjà résolu BRH.SG (Stuttgart) via le cache
}


def get_json(url, retries=2):
    req = urllib.request.Request(url, headers=HEADERS)
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=20, context=CTX) as r:
                return json.load(r)
        except Exception:
            if attempt == retries:
                raise
            time.sleep(1.5 * (attempt + 1))  # backoff : 1.5 s puis 3 s


def resolve_symbol(isin, cache):
    if isin in SYMBOL_OVERRIDES:
        return SYMBOL_OVERRIDES[isin]
    if isin in cache:
        return cache[isin]
    try:
        q = urllib.parse.quote(isin)
        s = get_json(f"https://query2.finance.yahoo.com/v1/finance/search?q={q}")
        quotes = s.get("quotes") or []
        sym = quotes[0]["symbol"] if quotes else None
    except Exception as e:
        print(f"   ⚠️ résolution {isin} échouée: {e}")
        sym = None
    cache[isin] = sym
    return sym


def chart(symbol, rng):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={rng}&interval=1mo"
    c = get_json(url)
    res = c["chart"]["result"][0]
    meta = res["meta"]
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    series = {}
    for t, cl in zip(ts, closes):
        if cl is None:
            continue
        d = datetime.fromtimestamp(t, tz=timezone.utc)
        series[f"{d.year:04d}-{d.month:02d}-01"] = cl
    return meta.get("regularMarketPrice"), (meta.get("currency") or "EUR").upper(), series


# cache des taux de change EUR (devise -> {mois: taux 'devise par EUR', 'now': taux})
_FX = {}


def fx(currency, rng):
    """Retourne (taux_actuel, {mois: taux}) où taux = unités de `currency` pour 1 EUR."""
    currency = currency.upper()
    if currency in ("EUR",):
        return 1.0, {}
    if currency == "GBP" or currency == "GBP=":
        pair = "EURGBP=X"
    elif currency == "USD":
        pair = "EURUSD=X"
    else:
        pair = f"EUR{currency}=X"
    if currency not in _FX:
        now, _, series = chart(pair, rng)
        _FX[currency] = (now, series)
    return _FX[currency]


def to_eur(value, currency, month, rng):
    """Convertit un montant en EUR. month=None → utilise le taux actuel."""
    if value is None:
        return None
    currency = currency.upper()
    if currency == "EUR":
        return value
    # certaines actions UK cotent en pence (GBp) : 1/100 GBP
    pence = currency in ("GBP", "GBX") and value > 1000  # heuristique pence
    rate_now, rate_series = fx("GBP" if currency in ("GBX",) else currency, rng)
    rate = (rate_series.get(month) if month else None) or rate_now
    if not rate:
        return value
    eur = value / rate
    if currency == "GBX" or pence:
        eur /= 100.0
    return eur


def prev_close_eur(symbol, currency, rng):
    """Clôture de la VEILLE (graphe journalier 5j) convertie en EUR."""
    try:
        c = get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range=5d&interval=1d")
        res = c["chart"]["result"][0]
        closes = [x for x in (res["indicators"]["quote"][0].get("close") or []) if x is not None]
        prev = closes[-2] if len(closes) >= 2 else None
    except Exception:
        prev = None
    return to_eur(prev, currency, None, rng) if prev else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=None, help="data.json pour extraire les ISIN des positions")
    ap.add_argument("--isins", default=None, help="liste d'ISIN séparés par des virgules")
    ap.add_argument("--range", default="5y")
    ap.add_argument("--out-prices", default=os.path.join(HERE, "prices.json"))
    ap.add_argument("--out-history", default=os.path.join(HERE, "price_history.json"))
    args = ap.parse_args()

    isins = []
    if args.isins:
        isins = [x.strip() for x in args.isins.split(",") if x.strip()]
    elif args.data:
        d = json.load(open(args.data, encoding="utf-8"))
        seen = set()
        for p in d.get("positions", []):
            i = p.get("isin")
            if i and i not in seen:
                seen.add(i); isins.append(i)
    if not isins:
        print("Aucun ISIN. Donne --isins ou --data avec des positions ayant un champ isin.")
        return

    cache_path = os.path.join(HERE, "symbols.json")
    cache = json.load(open(cache_path, encoding="utf-8")) if os.path.exists(cache_path) else {}

    prices, history, prevs = {}, {}, {}
    for isin in isins:
        sym = resolve_symbol(isin, cache)
        if not sym:
            print(f"{isin}: ❌ symbole introuvable")
            continue
        try:
            cur_price, currency, series = chart(sym, args.range)
        except Exception as e:
            print(f"{isin} ({sym}): ❌ chart {e}")
            continue
        hist_eur = {m: round(to_eur(v, currency, m, args.range), 4) for m, v in series.items()}
        cur_eur = to_eur(cur_price, currency, None, args.range)
        prices[isin] = round(cur_eur, 4) if cur_eur else None
        history[isin] = hist_eur
        prev_eur = prev_close_eur(sym, currency, args.range)
        if prev_eur:
            prevs[isin] = round(prev_eur, 4)
        fxnote = "" if currency == "EUR" else f" [{currency}→EUR]"
        print(f"{isin}: {sym} = {prices[isin]} € ({len(hist_eur)} mois){fxnote}")
        time.sleep(0.4)

    json.dump(cache, open(cache_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # fusion non-destructive : on garde les ISIN déjà connus (ex. lignes revendues)
    def merge_into(path, new, deep=False):
        old = {}
        if os.path.exists(path):
            try:
                old = json.load(open(path, encoding="utf-8"))
            except Exception:
                old = {}
        if deep:
            # fusion PAR MOIS : un fetch à range court (mode prices, 5d) ne doit pas
            # écraser l'historique mensuel complet déjà connu pour l'ISIN
            for k, v in new.items():
                if isinstance(v, dict) and isinstance(old.get(k), dict):
                    old[k].update(v)
                else:
                    old[k] = v
        else:
            old.update(new)
        return old

    prices = merge_into(args.out_prices, prices)
    history = merge_into(args.out_history, history, deep=True)
    prev_path = os.path.join(HERE, "prices_prev.json")
    prevs = merge_into(prev_path, prevs)
    prices["_comment"] = "Cours actuels EUR par ISIN — généré par fetch_prices.py (Yahoo). Relancer pour rafraîchir."
    json.dump(prices, open(args.out_prices, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(history, open(args.out_history, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump(prevs, open(prev_path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"\n✅ {args.out_prices} ({len([k for k in prices if k!='_comment'])} cours)")
    print(f"✅ {args.out_history} (historique mensuel EUR)")
    print(f"✅ {prev_path} (clôture veille)")


if __name__ == "__main__":
    main()
