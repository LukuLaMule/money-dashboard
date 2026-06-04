#!/usr/bin/env python3
"""
record_value.py — enregistre la valorisation courante (par compte) mesurée par le cron.

Appelé par refresh.sh (modes prices/full) APRÈS le rebuild de data.json :
  - append un point dans html/intraday.json   (la séance du jour, ~toutes les 10 min)
  - au premier run d'un nouveau jour, archive la dernière valeur de la veille
    dans html/daily.json (historique journalier) puis repart sur une séance vide
  - pose lastUpdateTime (ISO, heure Paris) dans data.json → indicateur de fraîcheur

Formats :
  intraday.json : {"date":"YYYY-MM-DD","invested":{acc:€},"points":[{"t":"HH:MM",acc:€,...}]}
  daily.json    : {"YYYY-MM-DD":{acc:{"v":valeur,"i":investi}, ...}, ...}
"""
import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
DATADIR = os.path.join(os.path.dirname(HERE), "data")
DATA = os.path.join(DATADIR, "data.json")
INTRADAY = os.path.join(DATADIR, "intraday.json")
DAILY = os.path.join(DATADIR, "daily.json")
PARIS = ZoneInfo("Europe/Paris")


def load(path, default):
    if os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8"))
        except Exception:
            return default
    return default


def dump(path, obj):
    tmp = path + ".tmp"
    json.dump(obj, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, path)


def main():
    data = json.load(open(DATA, encoding="utf-8"))
    now = datetime.now(PARIS)
    today, hhmm = now.strftime("%Y-%m-%d"), now.strftime("%H:%M")

    # valo courante par compte = dernier snapshot mensuel (porte la valeur live après rebuild)
    values, invested = {}, {}
    for acc in [a["id"] for a in data.get("accounts", [])]:
        snaps = [s for s in data.get("snapshots", []) if s["account"] == acc]
        if snaps:
            last = max(snaps, key=lambda s: s["date"])
            if last.get("value") is not None:
                values[acc] = round(last["value"], 2)
                invested[acc] = round(last.get("invested") or 0, 2)
    if not values:
        print("record_value: aucune valo trouvée, rien à faire")
        return

    intraday = load(INTRADAY, {})
    if intraday.get("date") != today:
        # nouveau jour : archive la dernière mesure de la séance précédente dans daily.json
        pts = intraday.get("points") or []
        if intraday.get("date") and pts:
            daily = load(DAILY, {})
            lastpt = pts[-1]
            inv = intraday.get("invested") or {}
            daily[intraday["date"]] = {
                acc: {"v": lastpt[acc], "i": inv.get(acc, 0)}
                for acc in values if acc in lastpt
            }
            dump(DAILY, dict(sorted(daily.items())))
        intraday = {"date": today, "invested": {}, "points": []}

    intraday["invested"] = invested
    intraday["points"].append({"t": hhmm, **values})
    dump(INTRADAY, intraday)

    # fraîcheur des cours pour le front
    data["lastUpdate"] = today
    data["lastUpdateTime"] = now.isoformat(timespec="seconds")
    dump(DATA, data)
    print(f"record_value: {hhmm} {values} ({len(intraday['points'])} pts aujourd'hui)")


if __name__ == "__main__":
    main()
