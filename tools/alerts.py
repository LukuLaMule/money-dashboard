#!/usr/bin/env python3
"""
alerts.py — notifications push via ntfy.sh (app mobile/desktop ntfy, abonnement au topic).

  alerts.py              → alerte si une position fait ±5 % sur la journée (1×/jour/position)
  alerts.py --tr-expired → alerte « session TR expirée » (1×/jour)

Topic secret dans tools/ntfy_topic.txt (gitignoré). État anti-spam dans tools/alerts_state.json.
S'abonner : installer l'app ntfy et s'abonner au topic (cat tools/ntfy_topic.txt).
"""
import json
import os
import sys
import urllib.request
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data", "data.json")
TOPIC_FILE = os.path.join(HERE, "ntfy_topic.txt")
STATE_FILE = os.path.join(HERE, "alerts_state.json")
THRESHOLD = 5.0  # % de variation jour qui déclenche l'alerte


def push(title, message, tags="chart_with_upwards_trend", priority="default"):
    topic = open(TOPIC_FILE).read().strip()
    req = urllib.request.Request(
        f"https://ntfy.sh/{topic}", data=message.encode(),
        headers={"Title": title.encode("latin-1", "ignore").decode("latin-1"),
                 "Tags": tags, "Priority": priority})
    urllib.request.urlopen(req, timeout=15)


def load_state():
    today = date.today().isoformat()
    try:
        s = json.load(open(STATE_FILE, encoding="utf-8"))
    except Exception:
        s = {}
    if s.get("date") != today:
        s = {"date": today, "alerted": [], "tr_alerted": False}
    return s


def save_state(s):
    json.dump(s, open(STATE_FILE, "w", encoding="utf-8"))


def main():
    if not os.path.exists(TOPIC_FILE):
        print("alerts: pas de topic ntfy configuré (tools/ntfy_topic.txt) — ignoré")
        return
    state = load_state()

    if "--tr-expired" in sys.argv:
        if not state.get("tr_alerted"):
            push("Session Trade Republic expirée",
                 "Le CTO ne se met plus a jour. Lancer cto_relogin.sh (2FA) sur le serveur.",
                 tags="warning", priority="high")
            state["tr_alerted"] = True
            save_state(state)
            print("alerts: notification session TR envoyée")
        return

    d = json.load(open(DATA, encoding="utf-8"))
    sent = 0
    for p in d.get("positions", []):
        last, prev, tk = p.get("last"), p.get("prevClose"), p.get("ticker", "?")
        if not last or not prev or tk in state["alerted"]:
            continue
        pct = (last - prev) / prev * 100
        if abs(pct) >= THRESHOLD:
            arrow = "📈" if pct > 0 else "📉"
            pnl = (p.get("shares") or 0) * (last - prev)
            push(f"{arrow} {p.get('label', tk)} {pct:+.1f} % aujourd'hui",
                 f"{tk} : {prev:.2f} → {last:.2f} EUR ({pnl:+.2f} EUR sur ta ligne)",
                 tags="chart_with_upwards_trend" if pct > 0 else "chart_with_downwards_trend")
            state["alerted"].append(tk)
            sent += 1
    if sent:
        save_state(state)
        print(f"alerts: {sent} notification(s) envoyée(s)")


if __name__ == "__main__":
    main()
