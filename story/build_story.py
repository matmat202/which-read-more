#!/usr/bin/env python3
"""data/year/ -> site/story/story.json: does anything on the card tell you which was read more?

    python3 fetch_year.py 2025-11-15 2026-11-14   # once: the year's two top-1000 lists
    python3 build_story.py                         # BUILD_OUT=... writes elsewhere (publish.sh compares)

The pairs are the game's own: for every day on disk, candidates() and roundsFor() from
site/read-logic.js, re-done here, with the page's ban loop (choose() in app.js) run against
each title's short description. Descriptions are fetched once into data/year/desc.json and
are TODAY's descriptions, not the day's; test/story.test.mjs re-draws every day's ten with
the real JS from the same files and requires the same list.

The question: the card shows a title and a one-line description. Six things a player could
read off it (CUES below), each asked the same way: in pairs where exactly one article has
it, how often is that one the more read? The control that could kill each answer: give the
same label to as many random articles from the same pairs, 1,000 times, and ask again.

The RNG is mulberry32, written out (the game's own), so neither the pairs nor the shuffles
depend on Python's random.
"""
import gzip, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
YEAR = os.path.join(HERE, "data", "year")
DESC = os.path.join(YEAR, "desc.json")
OUT = os.environ.get("BUILD_OUT", os.path.join(HERE, "site", "story", "story.json"))
N_SH, SEED, ROUNDS = 1000, 20261116, 10

# [key, label, JS-compatible regex on the description, only among (key or None)]
CUES = [
    ["person", "a person", r"\((born \d{4}|(c\. )?\d{3,4} ?[–-] ?\d{4})\)", None],
    ["alive", "alive (of two people)", r"\(born \d{4}\)", "person"],
    ["american", "American", r"^American\b", None],
    ["film", "a film", r"\bfilm\b(?!.*\((born|\d{4} ?[–-]))", None],
    ["tv", "a TV series", r"television.*series|series.*television", None],
    ["year", "dated 2025 or 2026", r"^20(25|26)\b", None],
]
HEAD = "year"

NS = re.compile(r"^(Main_Page$|(Special|Wikipedia|File|Portal|Talk|User|Template|Help|Category|Draft|Module|MediaWiki|TimedText|Book|Education_Program|Gadget|Topic)(_talk)?:)")
BANDS = [[5, float("inf")], [3.5, 9], [2.5, 6], [2, 4], [1.7, 3], [1.5, 2.4], [1.35, 1.9], [1.22, 1.6], [1.12, 1.4], [1.03, 1.2]]
BLOCK = re.compile("|".join([
    "porn", "sexual", r"\bsex\b", "sex offender", "erotic", "paraphilia", "fetish", "nud(e|ity)", r"\badult (film|model|entertain)",
    r"\bxxx\b", "xnxx", "xhamster", "xvideos", "onlyfans", "hentai", "escort",
    "murder", "killer", r"\bkilling", "massacre", "shooting", "stabbing", "suicide", "terror", r"\battacks?\b", "genocide",
    r"\brap(e|ist)\b", "filicide", "abuse", "disaster", "collapse", "airstrike", "assassinat", "^deaths in", "^death of"]))
M32 = 0xFFFFFFFF


def imul(a, b):
    return (a * b) & M32


def fnv_js(s):
    h = 0x811C9DC5
    b = s.encode("utf-16-le")
    for k in range(0, len(b), 2):
        h = imul(h ^ (b[k] | b[k + 1] << 8), 0x01000193)
    return h


def mulberry32(a):
    a &= M32

    def nxt():
        nonlocal a
        a = (a + 0x6D2B79F5) & M32
        t = a
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296
    return nxt


def candidates(rec):
    dv = {t: v for t, v in rec["desktop"]}
    floor = min(dv.values())
    out = []
    for t, v in rec["all"]:
        if NS.match(t) or not v > 0:
            continue
        d = dv.get(t)
        desk = None if d is None else d / v
        bound = floor / v if d is None else desk
        if (desk is not None and desk > 0.9) or bound < 0.05:
            continue
        out.append((t, v))
    return sorted(out, key=lambda x: (-x[1], x[0]))


def rounds_for(c, seed, ban):
    r = mulberry32(fnv_js(seed))
    N, used, out = len(c), set(), []
    for k in range(ROUNDS):
        lo, hi = BANDS[min(k, len(BANDS) - 1)]
        pair = None
        for _ in range(6):
            if pair:
                break
            t = 0
            while t < 3000 and not pair:
                t += 1
                i, j = int(r() * r() * N), int(r() * r() * N)
                if i == j or i in used or j in used or c[i][0] in ban or c[j][0] in ban:
                    continue
                a, b = c[i][1], c[j][1]
                if a != b and lo <= max(a, b) / min(a, b) <= hi:
                    pair = (i, j)
            lo, hi = 1 + (lo - 1) / 2, hi * 2
        if pair:
            used |= set(pair)
            out.append(pair)
    return out


def allowed(t, info):
    if not info or info["missing"] or info["dab"] or not info["d"]:
        return False
    return not BLOCK.search(t.replace("_", " ").lower()) and not BLOCK.search(info["d"].lower())


def game(days, recs, desc):
    """the game's ten per day, as (day index, title a, views a, title b, views b)"""
    out = []
    for di, day in enumerate(days):
        c, ban = candidates(recs[day]), set()
        for _ in range(8):
            rs = rounds_for(c, day, ban)
            bad = [c[k][0] for p in rs for k in p if not allowed(c[k][0], desc.get(c[k][0]))]
            if not bad:
                break
            ban |= set(bad)
        else:
            raise SystemExit(f"{day}: no ten found (is desc.json missing titles? see fetch in the probe)")
        out += [(di, c[i][0], c[i][1], c[j][0], c[j][1]) for i, j in rs]
    return out


def mixed(pairs, has, among=None):
    """pairs with exactly one article that has the cue -> (that one more read, n)"""
    won = n = 0
    for _, a, va, b, vb in pairs:
        if among and not (among(a) and among(b)):
            continue
        if has(a) == has(b):
            continue
        n += 1
        won += (va > vb) if has(a) else (vb > va)
    return won, n


def main():
    days = sorted(f[:10] for f in os.listdir(YEAR) if f.endswith(".json.gz"))
    recs = {d: json.load(gzip.open(os.path.join(YEAR, f"{d}.json.gz"))) for d in days}
    desc = json.load(open(DESC, encoding="utf-8"))
    pairs = game(days, recs, desc)
    arts = sorted({p[1] for p in pairs} | {p[3] for p in pairs})
    D = {t: desc[t]["d"] for t in arts}
    lab = {k: {t for t in arts if re.search(rx, D[t])} for k, _, rx, _ in CUES}
    rnd = mulberry32(SEED)
    check, shuffles = {"n_pairs": len(pairs), "n_days": len(days), "n_arts": len(arts)}, {}
    for k, _, _, among in CUES:
        pool = [t for t in arts if among is None or t in lab[among]]
        inpool = (lambda t: t in lab[among]) if among else None
        won, n = mixed(pairs, lab[k].__contains__, inpool)
        size = sum(t in lab[k] for t in pool)
        sh = []
        for _ in range(N_SH):
            s = pool[:]
            for i in range(len(s) - 1, 0, -1):
                j = int(rnd() * (i + 1))
                s[i], s[j] = s[j], s[i]
            w, m = mixed(pairs, set(s[:size]).__contains__, inpool)
            sh.append(round(w / m, 6) if m else 0.5)
        shuffles[k] = sh
        rate = won / n
        check.update({f"{k}_won": won, f"{k}_n": n, f"{k}_rate": round(rate, 6), f"{k}_size": size,
                      f"{k}_max": max(sh), f"{k}_med": sorted(sh)[N_SH // 2], f"{k}_high": sum(x >= rate for x in sh)})
    # where the head cue's lead lives: films dated this year or last, older films, dated non-films
    film, yr = lab["film"], lab[HEAD]
    for name, grp in (("newfilm", film & yr), ("oldfilm", film - yr), ("newother", yr - film)):
        rest = (film & yr) - grp                       # pairs with a new film on the other side are left out
        w, n = mixed([p for p in pairs if p[1] not in rest and p[3] not in rest], grp.__contains__)
        check.update({f"{name}_won": w, f"{name}_n": n})
    # a seventh cue tried and not drawn: of two living people, the younger
    w = n = 0
    for _, a, va, b, vb in pairs:
        ya, yb = re.search(r"\(born (\d{4})\)", D[a]), re.search(r"\(born (\d{4})\)", D[b])
        if ya and yb and ya.group(1) != yb.group(1):
            n += 1
            w += (va > vb) == (int(ya.group(1)) > int(yb.group(1)))
    check.update({"younger_won": w, "younger_n": n})
    half = days[len(days) // 2]
    for name, part in (("h1", [p for p in pairs if days[p[0]] < half]), ("h2", [p for p in pairs if days[p[0]] >= half])):
        w, n = mixed(part, lab[HEAD].__contains__)
        check[f"{name}_rate"] = round(w / n, 6)
    idx = {t: i for i, t in enumerate(arts)}
    out = {
        "source": "Wikimedia Pageviews API, top 1,000 English Wikipedia articles (all-access and desktop), one list per day; short descriptions from the Wikipedia action API, fetched November 2026",
        "days": days, "half": half, "seed": SEED, "head": HEAD,
        "cues": [{"key": k, "label": l, "re": rx, "among": a} for k, l, rx, a in CUES],
        "arts": [{"t": t, "d": D[t]} for t in arts],
        "pairs": [[di, idx[a], va, idx[b], vb] for di, a, va, b, vb in pairs],
        "shuffles": shuffles, "check": check,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    for k, l, _, _ in CUES:
        print(f"  {l:24} {check[k+'_won']}/{check[k+'_n']} = {check[k+'_rate']:.3f}   random sets: median {check[k+'_med']:.3f}, max {check[k+'_max']:.3f}, {check[k+'_high']} as high")
    for name in ("newfilm", "oldfilm", "newother"):
        print(f"  {name}: {check[name+'_won']}/{check[name+'_n']}")
    print(f"  halves ({HEAD}): {check['h1_rate']:.3f} before {half}, {check['h2_rate']:.3f} from it")


if __name__ == "__main__":
    main()
