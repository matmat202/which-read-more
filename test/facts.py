#!/usr/bin/env python3
"""Facts the page's logic must agree with, computed from the committed fixture by this
file's own reading of the rules, NOT by read-logic.js. Writes test/facts.json; the JS
suite runs its pipeline on the same fixture and must land on the same articles.

    python3 test/facts.py
"""
import json
import os
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
DAY = "2026-10-26"
FIX = HERE.parent / "data" / DAY
NOT_ARTICLE = ("Special", "Wikipedia", "File", "Portal", "Talk", "User", "Template", "Help", "Category", "Draft",
               "Module", "MediaWiki", "TimedText", "Book", "Education_Program", "Gadget", "Topic")
WORDS = ["porn", "sexual", r"\bsex\b", "sex offender", "erotic", "paraphilia", "fetish", "nude", "nudity", r"\badult film",
         r"\badult model", r"\badult entertain", r"\bxxx\b", "xnxx", "xhamster", "xvideos", "onlyfans", "hentai", "escort",
         "murder", "killer", r"\bkilling", "massacre", "shooting", "stabbing", "suicide", "terror", r"\battack\b", r"\battacks\b",
         "genocide", r"\brape\b", r"\brapist\b", "filicide", "abuse", "disaster", "collapse", "airstrike", "assassinat",
         "^deaths in", "^death of"]


def articles(name):
    return json.loads((FIX / f"{name}.json").read_text())["items"][0]["articles"]


def is_article(t):
    if t == "Main_Page":
        return False
    head = t.split(":", 1)[0]
    return not (":" in t and (head in NOT_ARTICLE or (head.endswith("_talk") and head[:-5] in NOT_ARTICLE + ("",))))


def bad(text):
    return any(re.search(w, text.lower()) for w in WORDS)


desk = {a["article"]: a["views"] for a in articles("desktop")}
floor = min(desk.values())
desc = json.loads((FIX / "desc.json").read_text())
cands, dropped_share = [], []
for a in articles("all"):
    t, v = a["article"], a["views"]
    if not is_article(t):
        continue
    share = desk[t] / v if t in desk else None
    if (share is not None and share > 0.9) or (share if share is not None else floor / v) < 0.05:
        dropped_share.append(t)
        continue
    cands.append((v, t))
cands.sort(key=lambda x: (-x[0], x[1]))
shown = [t for v, t in cands if (i := desc.get(t)) and i["d"] and not i["dab"] and not i["missing"]
         and not bad(t.replace("_", " ")) and not bad(i["d"])]
out = {"day": DAY, "candidates": len(cands), "dropped_share": sorted(dropped_share), "shown": shown,
       "views": {t: v for v, t in cands}}
pathlib.Path(os.environ.get("FACTS_DIR") or HERE).joinpath("facts.json").write_text(json.dumps(out, indent=0) + "\n")
print(len(cands), "candidates,", len(shown), "showable,", len(dropped_share), "dropped on share")
