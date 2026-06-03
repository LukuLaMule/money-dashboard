#!/usr/bin/env python3
"""
fetch_news.py — récupère des actus éco via les flux RSS Yahoo Finance et écrit news.json.

- Flux marché général (CAC 40) + flux par valeur détenue (symboles depuis symbols.json).
- Sortie : html/news.json { source, generated, items: [{title, link, date, source}] }.

Le site est statique → ce script tourne côté serveur (cron) et rafraîchit news.json.

Usage :
  python3.11 fetch_news.py --out /home/opc/Docker/sites/money/html/news.json
"""
import argparse
import json
import os
import re
import ssl
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
H = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
YH = "https://feeds.finance.yahoo.com/rss/2.0/headline?s={syms}&region=FR&lang=fr-FR"


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=20, context=CTX).read().decode("utf-8", "ignore")


def tag(block, name):
    m = re.search(rf"<{name}[^>]*>(.*?)</{name}>", block, re.S)
    if not m:
        return ""
    t = m.group(1).strip()
    t = re.sub(r"<!\[CDATA\[(.*?)\]\]>", r"\1", t, flags=re.S)
    return re.sub(r"<[^>]+>", "", t).strip()


def parse_items(xml):
    out = []
    for block in re.findall(r"<item>(.*?)</item>", xml, re.S):
        title = tag(block, "title")
        link = tag(block, "link")
        pub = tag(block, "pubDate")
        src = tag(block, "source") or "Yahoo Finance"
        date = None
        if pub:
            try:
                date = parsedate_to_datetime(pub).astimezone(timezone.utc).isoformat()
            except Exception:
                date = None
        if title and link:
            out.append({"title": title, "link": link, "date": date, "source": src})
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(HERE), "html", "news.json"))
    ap.add_argument("--symbols", default=os.path.join(HERE, "symbols.json"))
    args = ap.parse_args()

    # symboles des valeurs détenues (pour des actus ciblées)
    held = []
    if os.path.exists(args.symbols):
        held = [s for s in json.load(open(args.symbols)).values() if s][:12]

    feeds = ["^FCHI"]                       # marché : CAC 40
    if held:
        feeds.append(",".join(held))         # actus des valeurs détenues

    items, seen = [], set()
    for syms in feeds:
        try:
            for it in parse_items(fetch(YH.format(syms=urllib.parse.quote(syms, safe=",^")))):
                key = it["title"]
                if key not in seen:
                    seen.add(key); items.append(it)
        except Exception as e:
            print(f"⚠️ flux {syms}: {e}")

    items.sort(key=lambda x: x["date"] or "", reverse=True)
    out = {"source": "Yahoo Finance", "generated": datetime.now(timezone.utc).isoformat(), "items": items[:25]}
    json.dump(out, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"✅ {args.out} — {len(out['items'])} actus")


if __name__ == "__main__":
    main()
