#!/usr/bin/env python3
"""A year of the two Wikimedia top-1000 lists the game draws from -> data/year/<day>.json.gz

    python3 fetch_year.py 2025-11-15 2026-11-14

Each file is {"all": [[title, views], ...], "desktop": [[title, views], ...]}, the
responses' article lists in rank order and nothing else. Days already on disk are skipped.
"""
import concurrent.futures as cf, gzip, json, pathlib, sys, time, urllib.request
from datetime import date, timedelta

UA = "which-read-more story data (https://matmat202.github.io/which-read-more/)"
TOP = "https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/{access}/{d}"
OUT = pathlib.Path(__file__).resolve().parent / "data" / "year"


def get(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(2 ** k)


def one(day):
    f = OUT / f"{day}.json.gz"
    if f.exists():
        return day, "have"
    rec = {}
    for name, access in (("all", "all-access"), ("desktop", "desktop")):
        arts = get(TOP.format(access=access, d=day.replace("-", "/")))["items"][0]["articles"]
        rec[name] = [[a["article"], a["views"]] for a in arts]
    f.write_bytes(gzip.compress(json.dumps(rec).encode()))
    return day, len(rec["all"])


def main(a, b):
    OUT.mkdir(parents=True, exist_ok=True)
    d0, d1 = date.fromisoformat(a), date.fromisoformat(b)
    days = [(d0 + timedelta(k)).isoformat() for k in range((d1 - d0).days + 1)]
    bad = []
    with cf.ThreadPoolExecutor(1) as ex:
        for fut in cf.as_completed([ex.submit(one, d) for d in days]):
            try:
                fut.result()
            except Exception as e:
                bad.append(repr(e)[:120])
    print(f"{len(days) - len(bad)}/{len(days)} days on disk; failures: {bad[:3]}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
