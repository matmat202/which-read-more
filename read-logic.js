// Which Read More? — the page's pure logic. No DOM, no fetch; imported by app.js and the test.
//
// The page fetches two Wikimedia lists for one day — the top 1,000 English Wikipedia
// articles across all access, and the top 1,000 on desktop — plus each shown article's
// short description. Everything here works on those responses as they arrive.

export const ROUNDS = 10;
export const TOP = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia';
export const API = 'https://en.wikipedia.org/w/api.php';

// How far apart the two articles' views are, as a ratio [lo, hi]: one read five times as
// much first, within a few percent of each other last.
export const BANDS = [
  [5, Infinity], [3.5, 9], [2.5, 6], [2, 4], [1.7, 3], [1.5, 2.4], [1.35, 1.9], [1.22, 1.6], [1.12, 1.4], [1.03, 1.2],
];

// Not articles: the Main Page and every non-article namespace.
const NS = /^(Main_Page$|(Special|Wikipedia|File|Portal|Talk|User|Template|Help|Category|Draft|Module|MediaWiki|TimedText|Book|Education_Program|Gadget|Topic)(_talk)?:)/;

// Wikimedia's own Top-25 Report drops pages whose traffic is nearly all desktop or nearly
// all mobile, because people do not read like that and scripts do. Desktop share is known
// for a page in the desktop top 1,000; for one that is not, its desktop views are below
// that list's last entry, which bounds the share from above. Drop only on evidence:
// a measured share over 90%, or a share (measured or bounded) under 5%.
export const DESK_MAX = 0.9, DESK_MIN = 0.05;

// A light game about what people read is no place to guess at victims or at porn. Matched
// against the title and the article's own short description, both lowercased, so the
// description does most of the work ("American serial killer", "pornographic film actress").
const BLOCK = new RegExp([
  'porn', 'sexual', '\\bsex\\b', 'sex offender', 'erotic', 'paraphilia', 'fetish', 'nud(e|ity)', '\\badult (film|model|entertain)',
  '\\bxxx\\b', 'xnxx', 'xhamster', 'xvideos', 'onlyfans', 'hentai', 'escort',
  'murder', 'killer', '\\bkilling', 'massacre', 'shooting', 'stabbing', 'suicide', 'terror', '\\battacks?\\b', 'genocide',
  '\\brap(e|ist)\\b', 'filicide', 'abuse', 'disaster', 'collapse', 'airstrike', 'assassinat', '^deaths in', '^death of',
].join('|'));

export const nice = (t) => t.replace(/_/g, ' ');

// The day's candidates from the two top lists: [{t, v, desk}] most-read first.
// `desk` is the desktop share, or null when only its upper bound is known.
export function candidates(all, desktop) {
  const items = (x) => (x && x.items && x.items[0] && x.items[0].articles) || [];
  const dv = new Map(items(desktop).map((a) => [a.article, a.views]));
  const floor = dv.size ? Math.min(...dv.values()) : Infinity;
  const out = [];
  for (const a of items(all)) {
    if (NS.test(a.article) || !(a.views > 0)) continue;
    const d = dv.get(a.article);
    const desk = d == null ? null : d / a.views;
    const bound = d == null ? floor / a.views : desk;
    if ((desk != null && desk > DESK_MAX) || bound < DESK_MIN) continue;
    out.push({ t: a.article, v: a.views, desk });
  }
  return out.sort((x, y) => y.v - x.v || (x.t < y.t ? -1 : 1));
}

// Whether an article may be shown, given what the action API said about it
// ({d: description, dab: disambiguation page, missing}). Undescribed pages go too:
// there is nothing to put under the name, and they skew toward the obscure and the odd.
export function allowed(t, info) {
  if (!info || info.missing || info.dab || !info.d) return false;
  return !BLOCK.test(nice(t).toLowerCase()) && !BLOCK.test(info.d.toLowerCase());
}

// The action API's answer for a batch -> {asked title: {d, dab, missing}}. It normalises
// "Al_Pacino" to "Al Pacino" and follows redirects; both are mapped back to what was asked.
export function readDescriptions(json) {
  const q = (json && json.query) || {};
  const back = new Map();
  for (const n of q.normalized || []) back.set(n.to, n.from);
  for (const n of q.redirects || []) back.set(n.to, back.get(n.from) || n.from);
  const out = {};
  for (const p of q.pages || []) {
    out[back.get(p.title) || p.title] = { d: p.description || '', dab: !!(p.pageprops && 'disambiguation' in p.pageprops), missing: !!p.missing };
  }
  return out;
}

export function descriptionURL(titles) {
  const q = new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', redirects: '1',
    prop: 'description|pageprops', ppprop: 'disambiguation', titles: titles.join('|') });
  return `${API}?${q}`;
}

export function topURL(access, ymd) { return `${TOP}/${access}/${ymd.replace(/-/g, '/')}`; }

// FNV-1a: a string to a 32-bit seed.
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// mulberry32: small, fast, and the same sequence in every browser.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fits(a, b, [lo, hi]) {
  const x = Math.max(a.v, b.v) / Math.min(a.v, b.v);
  return a.v !== b.v && x >= lo && x <= hi;
}

// Squaring a uniform draw leans toward the most-read without ruling out the rest.
const draw = (r, n) => Math.floor(r() * r() * n);

// The day's rounds: [[i, j]] indexes into `cands`, in the order shown. `banned` is the set
// of titles found unshowable so far; the page re-runs this with a growing set until every
// chosen title is allowed, so everyone with the same lists gets the same ten.
export function roundsFor(cands, seedStr, banned = new Set(), n = ROUNDS) {
  const r = rng(hash(seedStr));
  const N = cands.length;
  const used = new Set();
  const out = [];
  for (let k = 0; k < n; k++) {
    let [lo, hi] = BANDS[Math.min(k, BANDS.length - 1)];
    let pair = null;
    for (let widen = 0; !pair && widen < 6; widen++) {
      for (let t = 0; t < 3000 && !pair; t++) {
        const i = draw(r, N), j = draw(r, N);
        if (i === j || used.has(i) || used.has(j) || banned.has(cands[i].t) || banned.has(cands[j].t)) continue;
        if (fits(cands[i], cands[j], [lo, hi])) pair = [i, j]; // two independent draws: either may be the more read
      }
      lo = 1 + (lo - 1) / 2; hi = hi * 2;
    }
    if (!pair) continue;
    used.add(pair[0]); used.add(pair[1]);
    out.push(pair);
  }
  return out;
}

export function titlesOf(cands, rounds) { return rounds.flat().map((i) => cands[i].t); }

export function higherIndex(va, vb) { return va >= vb ? 0 : 1; }
export function isRight(va, vb, pick) { return va === vb || higherIndex(va, vb) === pick; }

const num = (v, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const views = (v) => `${num(v)} view${v === 1 ? '' : 's'}`;

export function times(hi, lo) {
  if (lo <= 0) return '';
  const x = hi / lo;
  if (x >= 1.95) return `${num(x, x >= 10 ? 0 : 1)} times as many`;
  return `${num(Math.max(1, Math.round((x - 1) * 100)))}% more`;
}

export function verdict(an, av, bn, bv) {
  const [hn, hv, ln, lv] = higherIndex(av, bv) === 0 ? [an, av, bn, bv] : [bn, bv, an, av];
  const t = times(hv, lv);
  return `${hn}: ${views(hv)}. ${ln}: ${views(lv)}.${t ? ` ${t[0].toUpperCase()}${t.slice(1)}.` : ''}`;
}

// Wikimedia publishes a UTC day some hours after it ends. The day to try first is
// yesterday in UTC; the page falls back one more day while that one is not out yet.
export function utcDay(ms, back = 1) { return new Date(ms - back * 86400000).toISOString().slice(0, 10); }

// A day asked for in the URL (?day=2026-10-26): a real calendar date, no earlier than the
// pageviews API's first day and no later than yesterday in UTC. Anything else is ignored.
export const FIRST_DAY = '2015-07-01';
export function pickDay(param, ms) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(param || '')) return null;
  const t = Date.parse(param + 'T00:00:00Z');
  if (!(t >= 0) || new Date(t).toISOString().slice(0, 10) !== param) return null;
  return param >= FIRST_DAY && param <= utcDay(ms) ? param : null;
}

export function longDay(ymd) {
  const d = new Date(ymd + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export function shareText(day, marks) {
  const score = marks.filter(Boolean).length;
  return `Which Read More? ${day}: ${score}/${marks.length}\n${marks.map((m) => (m ? '🟩' : '🟥')).join('')}`;
}

// Consecutive data days played, ending at `today` or the day before.
export function streak(days, today) {
  const have = new Set(days);
  let d = Date.parse(today + 'T12:00:00Z');
  if (!have.has(today)) d -= 86400000;
  let n = 0;
  while (have.has(new Date(d).toISOString().slice(0, 10))) { n++; d -= 86400000; }
  return n;
}
