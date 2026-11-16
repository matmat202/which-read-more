/* The scrolling story: each <section class="step"> names a layout in data-step; as the
 * reader scrolls into a step, the marks move to their place in that layout. Numbers in
 * the prose are not typed in: a <b data-fact="..."> is computed here from story.json's
 * rows, and test/story.test.mjs checks each against the `check` block build_story.py
 * computed in python. Modelled on which-leaked/site/story. */
import { layout, labels, mixed, won, cueRate, groups, STEPS, RATE, GROUPS, COL } from './layout.js';

const fmt = (n) => n.toLocaleString('en-US');
const pct = (v) => `${Math.round(v * 100)}%`;
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const BORN = /\(born (\d{4})\)/;

export function numbers(D) {
  const N = { n_pairs: D.pairs.length, n_days: D.days.length, n_arts: D.arts.length };
  for (const c of D.cues) {
    const R = cueRate(D, c.key), rate = R.won / R.n, sh = D.shuffles[c.key];
    const L = labels(D), pool = c.among ? L[c.among] : null;
    Object.assign(N, {
      [`${c.key}_won`]: R.won, [`${c.key}_n`]: R.n, [`${c.key}_rate`]: rate,
      [`${c.key}_size`]: pool ? [...L[c.key]].filter((i) => pool.has(i)).length : L[c.key].size,
      [`${c.key}_max`]: Math.max(...sh), [`${c.key}_med`]: median(sh), [`${c.key}_high`]: sh.filter((v) => v >= rate).length,
    });
  }
  const G = groups(D);
  for (const [k] of GROUPS) Object.assign(N, { [`${k}_won`]: G[k].won, [`${k}_n`]: G[k].n });
  let yw = 0, yn = 0;
  for (const [, a, va, b, vb] of D.pairs) {
    const ya = BORN.exec(D.arts[a].d), yb = BORN.exec(D.arts[b].d);
    if (ya && yb && ya[1] !== yb[1]) { yn++; yw += (va > vb) === (+ya[1] > +yb[1]); }
  }
  Object.assign(N, { younger_won: yw, younger_n: yn });
  const L = labels(D);
  for (const [name, part] of [['h1', D.pairs.filter((p) => D.days[p[0]] < D.half)], ['h2', D.pairs.filter((p) => D.days[p[0]] >= D.half)]]) {
    const M = mixed({ ...D, pairs: part }, L[D.head]);
    N[`${name}_rate`] = M.filter(won).length / M.length;
  }
  N.clear = D.cues.filter((c) => N[`${c.key}_high`] === 0).map((c) => c.key);
  return N;
}

const month = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/* "rate:year" -> "60%". Unknown names throw: a typo must not render as blank */
export function fact(D, spec) {
  const N = numbers(D);
  const [f, k] = spec.split(':');
  const has = (x) => { if (!(x in N)) throw new Error(`unknown fact ${spec}`); return N[x]; };
  switch (f) {
    case 'n_pairs': case 'n_days': case 'n_arts': return fmt(has(f));
    case 'missing': {
      const span = (Date.parse(`${D.days.at(-1)}T00:00:00Z`) - Date.parse(`${D.days[0]}T00:00:00Z`)) / 864e5 + 1;
      return fmt(span - D.days.length);
    }
    case 'first': return month(D.days[0]);
    case 'last': return month(D.days.at(-1));
    case 'half': return month(D.half);
    case 'n_sh': return fmt(D.shuffles[D.head].length);
    case 'won': return fmt(has(`${k}_won`));
    case 'n': return fmt(has(`${k}_n`));
    case 'lost': return fmt(has(`${k}_n`) - has(`${k}_won`));
    case 'rate': return pct(k ? has(`${k}_rate`) : 0);
    case 'rate1': return pct1(has(`${k}_rate`));
    case 'grate': return pct(has(`${k}_won`) / has(`${k}_n`));
    case 'glost': return pct(1 - has(`${k}_won`) / has(`${k}_n`));
    case 'med': return pct(has(`${k}_med`));
    case 'max': return pct(has(`${k}_max`));
    case 'max1': return pct1(has(`${k}_max`));
    case 'high': return fmt(has(`${k}_high`));
    case 'size': return fmt(has(`${k}_size`));
    case 'h': return pct(has(`${k}_rate`));
    default: throw new Error(`unknown fact ${spec}`);
  }
}

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const nice = (t) => t.replace(/_/g, ' ');

async function main() {
  const D = await (await fetch('story.json')).json();
  for (const e of document.querySelectorAll('[data-fact]')) e.textContent = fact(D, e.dataset.fact);
  const steps = [...document.querySelectorAll('.step')];
  for (const s of steps) if (!STEPS[s.dataset.step]) throw new Error(`unknown step ${s.dataset.step}`);
  const plot = document.getElementById('plot');
  const svg = el('svg', { id: 'chart' });
  const gAxis = el('g', { class: 'axis' }), gS = el('g'), gP = el('g'), gF = el('g'), gR = el('g'), gLab = el('g', { class: 'labels' });
  svg.append(gAxis, gS, gP, gF, gR, gLab);
  plot.append(svg);
  const mk = (g, rows, title) => rows.map((r, k) => {
    const c = g.appendChild(el('circle', { r: 0 }));
    c.append(el('title')); c.firstChild.textContent = title(r, k);
    return c;
  });
  const keys = D.cues.map((c) => c.key);
  const rDots = mk(gR, D.cues, (c) => `${c.label}: the real one`);
  const vs = ([va, vb, a, b]) => `${nice(D.arts[a].t)} (${fmt(va)} views) vs ${nice(D.arts[b].t)} (${fmt(vb)})`;
  const pDots = mk(gP, cueRate(D, D.head).M, vs);
  const G = groups(D);
  const fDots = mk(gF, GROUPS.flatMap(([k]) => G[k].M), vs);
  const tick = (x, y, text, cls = 'tick') => { const t = el('text', { x, y, class: cls }); t.textContent = text; gAxis.append(t); };
  const grid = (x1, y1, x2, y2, cls = 'grid') => gAxis.append(el('line', { x1, x2, y1, y2, class: cls }));

  let shown = -1;
  const draw = (i) => {
    const name = steps[i].dataset.step;
    const box = plot.getBoundingClientRect(), W = box.width, H = box.height;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const L = layout(name, D, W, H);
    const sets = [[rDots, L.real], [pDots, L.pairs], [fDots, L.films]];
    // 6,000 animated dots for the random sets left the page a step behind the scroll, so they are bars
    gS.replaceChildren();
    for (const c of D.cues) for (const b of L.shuffles[c.key]) {
      const r = gS.appendChild(el('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'bar' }));
      r.append(el('title')); r.firstChild.textContent = `${b.n} random sets labelled “${c.label}”`;
    }
    for (const [dots, lay] of sets) lay.forEach((d, k) => {
      const c = dots[k];
      c.style.transform = `translate(${d.x}px, ${d.y}px)`;
      c.setAttribute('r', d.r);
      c.style.fill = d.fill;
      c.style.opacity = d.op;
    });
    gAxis.replaceChildren(); gLab.replaceChildren();
    const labs = [];
    if (name === 'cues' || name === 'shuffle') {
      for (let v = 0.4; v <= RATE[1] + 1e-9; v += 0.1) { grid(L.X(v), 0, L.X(v), H, Math.abs(v - 0.5) < 1e-9 ? 'grid zero' : 'grid'); tick(L.X(v), H + 16, pct(v), 'tick mid'); }
      tick(W / 2, H + 32, 'how often the article with it was the more read', 'tick mid');
      L.show.forEach((key, k) => {
        const c = D.cues.find((x) => x.key === key);
        tick(0, L.Y(k) - L.rowH + 14, c.label, 'tick cat');
      });
      if (name === 'shuffle') labs.push([L.real[keys.indexOf(D.head)], 'the real ones']);
    } else if (name === 'pairs') {
      tick(0, -6, `${fmt(L.pairs.length)} pairs with one article dated 2025 or 2026: red if it was the more read`, 'tick');
      tick(0, H + 16, 'each dot, one pair', 'tick');
      tick(W, H + 16, `${L.cols} to a row`, 'tick end');
    } else {
      L.bands.forEach((b) => {
        const g = G[b.key], label = GROUPS.find(([k]) => k === b.key)[1];
        tick(0, b.y + 15, `${label}: ${fmt(g.won)} of ${fmt(g.n)}, ${pct(g.won / g.n)}`, 'tick cat');
      });
      tick(0, H + 16, 'each dot, one pair; red if that one was the more read', 'tick');
    }
    for (const [d, text] of labs) {
      gLab.append(el('circle', { cx: d.x, cy: d.y, r: d.r + 2.5, class: 'ring' }));
      const right = d.x < W * 0.6;
      const tx = el('text', { x: d.x + (right ? 1 : -1) * (d.r + 5), y: d.y - d.r - 3, class: `lab${right ? '' : ' end'}` });
      tx.textContent = text;
      gLab.append(tx);
    }
    document.body.dataset.step = i;
    const bars = keys.reduce((n, k) => n + L.shuffles[k].length, 0);
    window.__story = { step: i, name, shown: bars + [...L.real, ...L.pairs, ...L.films].filter((d) => d.op > 0).length };
  };

  const pick = () => {
    const line = innerHeight * 0.5;
    let i = 0;
    for (let k = 0; k < steps.length; k++) if (steps[k].getBoundingClientRect().top < line) i = k;
    if (i !== shown) { shown = i; draw(i); }
  };
  addEventListener('scroll', pick, { passive: true });
  addEventListener('resize', () => { shown = -1; pick(); });
  pick();
}

export { COL };

if (typeof document !== 'undefined') main().catch((e) => {
  document.body.classList.add('failed');
  document.getElementById('err').textContent = String(e.message || e);
  console.error(e);
});
