/* Where every mark sits on each step of the story. Pure: no DOM, so test/story.test.mjs
 * runs every layout at several plot sizes. Modelled on which-leaked/site/story.
 *
 * "cues": one row per cue a player could read off a card; in each, 1,000 random article
 * sets given that label (a grey histogram of their win rates) and the real cue (one red dot).
 * "pairs": one dot per pair of the year's games with exactly one article dated 2025 or
 * 2026, red if that one was read more. "films": the same question split three ways.
 * "shuffle": the head cue's 1,000 random sets alone, with the real one.
 */
export const COL = { hit: '#b3261e', other: '#8a857e', lost: '#cfcac3', faint: '#cfcac3' };
export const RATE = [0.35, 0.7];
export const BIN = 0.005;
export const STEPS = { cues: 'cues', pairs: 'pairs', films: 'films', shuffle: 'shuffle' };
export const GROUPS = [['newfilm', 'a film dated 2025 or 2026'], ['oldfilm', 'an older film'], ['newother', 'anything else dated 2025 or 2026']];

const memo = new WeakMap();
/* cue key -> Set of article indexes whose description matches it */
export function labels(D) {
  if (memo.has(D)) return memo.get(D);
  const out = {};
  for (const c of D.cues) {
    const rx = new RegExp(c.re);
    out[c.key] = new Set(D.arts.map((a, i) => (rx.test(a.d) ? i : -1)).filter((i) => i >= 0));
  }
  memo.set(D, out);
  return out;
}
/* pairs with exactly one article in `has` (both in `among`, if given) -> [[that one's views, the other's], ...] */
export function mixed(D, has, among = null, skip = null) {
  const out = [];
  for (const [, a, va, b, vb] of D.pairs) {
    if (among && !(among.has(a) && among.has(b))) continue;
    if (skip && (skip.has(a) || skip.has(b))) continue;
    if (has.has(a) === has.has(b)) continue;
    out.push(has.has(a) ? [va, vb, a, b] : [vb, va, b, a]);
  }
  return out;
}
export const won = (p) => p[0] > p[1];
export function cueRate(D, key) {
  const L = labels(D), c = D.cues.find((x) => x.key === key);
  const M = mixed(D, L[key], c.among ? L[c.among] : null);
  return { won: M.filter(won).length, n: M.length, M };
}
/* the three film groups, as in build_story.py: pairs with a new film on the far side are left out */
export function groups(D) {
  const L = labels(D), film = L.film, yr = L[D.head];
  const nf = new Set([...film].filter((i) => yr.has(i)));
  const g = { newfilm: nf, oldfilm: new Set([...film].filter((i) => !yr.has(i))), newother: new Set([...yr].filter((i) => !film.has(i))) };
  return Object.fromEntries(GROUPS.map(([k]) => {
    const M = mixed(D, g[k], null, k === 'newfilm' ? null : nf);
    return [k, { won: M.filter(won).length, n: M.length, M }];
  }));
}

/* -> {kind, X, shuffles: {key: [{x,y,w,h,n}] histogram bars}, real: [...], pairs: [...], films: [...]} in px of w x h */
export function layout(name, D, w, h) {
  if (!STEPS[name]) throw new Error(`unknown step ${name}`);
  const pad = 8;
  const none = () => ({ x: w / 2, y: h / 2, r: 0, op: 0, fill: COL.faint });
  const keys = D.cues.map((c) => c.key);
  const head = cueRate(D, D.head), G = groups(D);
  const out = {
    kind: name,
    shuffles: Object.fromEntries(keys.map((k) => [k, []])),
    real: keys.map(none), pairs: head.M.map(none),
    films: GROUPS.flatMap(([k]) => G[k].M.map(none)),
  };
  const X = (v) => pad + ((v - RATE[0]) / (RATE[1] - RATE[0])) * (w - 2 * pad);
  // the random sets as a histogram: one bar per BIN of win rate, its height the share of sets in it
  const hist = (vals, base, room) => {
    const cnt = {};
    for (const v of vals) { const b = Math.round(v / BIN); cnt[b] = (cnt[b] || 0) + 1; }
    const most = Math.max(...Object.values(cnt)), bw = Math.max(1, (X(BIN) - X(0)) * 0.7);
    return Object.entries(cnt).map(([b, n]) => ({ x: X(b * BIN) - bw / 2, y: base - (room * n) / most, w: bw, h: (room * n) / most, n: +n }));
  };
  if (name === 'cues' || name === 'shuffle') {
    const show = name === 'cues' ? keys : [D.head];
    const rowH = (h - 2 * pad) / show.length;
    const Y = (k) => pad + rowH * (k + 1);
    show.forEach((key, k) => {
      out.shuffles[key] = hist(D.shuffles[key], Y(k) - 2, rowH * (name === 'cues' ? 0.62 : 0.85));
      const R = cueRate(D, key), big = Math.max(4.5, Math.min(8, rowH * 0.18));
      out.real[keys.indexOf(key)] = { x: X(R.won / R.n), y: Y(k) - 2 - big, r: big, fill: COL.hit, op: 1 };
    });
    return { ...out, X, Y, show, rowH };
  }
  const waffle = (M, x0, y0, bw, bh) => {
    const order = M.map((p, k) => [won(p) ? 0 : 1, k]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((x) => x[1]);
    const cols = Math.max(10, Math.round(Math.sqrt((M.length * bw) / bh)));
    const rows = Math.ceil(M.length / cols);
    const cell = Math.min(bw / cols, bh / rows), r = Math.max(1, cell * 0.42);
    const pos = [];
    order.forEach((k, j) => { pos[k] = j; });
    return { cols, cell, pts: M.map((p, k) => ({ x: x0 + cell * ((pos[k] % cols) + 0.5), y: y0 + cell * (Math.floor(pos[k] / cols) + 0.5), r, fill: won(p) ? COL.hit : COL.lost, op: 1 })) };
  };
  if (name === 'pairs') {
    const W = waffle(head.M, pad, pad, w - 2 * pad, h - 2 * pad);
    out.pairs = W.pts;
    return { ...out, cols: W.cols };
  }
  // films: three bands, each a waffle under its own label line, sized by how many pairs it has
  const lab = 22, total = GROUPS.reduce((s, [k]) => s + G[k].M.length, 0), room = h - 2 * pad - GROUPS.length * lab;
  let y = pad;
  const bands = [];
  GROUPS.forEach(([k]) => {
    const bh = Math.max(12, room * (G[k].M.length / total));
    const W = waffle(G[k].M, pad, y + lab, w - 2 * pad, bh);
    bands.push({ key: k, y, pts: W.pts });
    y += lab + bh;
  });
  out.films = bands.flatMap((b) => b.pts);
  return { ...out, bands };
}
