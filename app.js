// Which Read More? — the page. Pure logic lives in read-logic.js.
import * as L from './read-logic.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on, unsaved */ } },
};

let DAY = null, PAST = false, CANDS = [], INFO = {};
let game = null; // { key, practice, rounds, picks, showing }

const getJSON = (url) => fetch(url).then((r) => { if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; } return r.json(); });

// Yesterday in UTC, or the day before while yesterday's lists are not out yet.
async function loadLists() {
  const asked = L.pickDay(new URLSearchParams(location.search).get('day'), Date.now());
  let last;
  for (const back of asked ? [0] : [1, 2, 3]) {
    const day = asked || L.utcDay(Date.now(), back);
    try {
      const [all, desk] = await Promise.all([getJSON(L.topURL('all-access', day)), getJSON(L.topURL('desktop', day))]);
      return { day, all, desk };
    } catch (e) { last = e; if (e.status !== 404) break; }
  }
  throw last;
}

// Choose the ten, look up what has not been looked up, ban what may not be shown, choose
// again. The choice depends only on the lists and the bans, so everyone gets the same ten.
async function choose(seed) {
  const ban = new Set();
  for (let tries = 0; tries < 8; tries++) {
    const rounds = L.roundsFor(CANDS, seed, ban);
    const titles = L.titlesOf(CANDS, rounds);
    const ask = titles.filter((t) => !(t in INFO));
    for (let k = 0; k < ask.length; k += 50) Object.assign(INFO, L.readDescriptions(await getJSON(L.descriptionURL(ask.slice(k, k + 50)))));
    for (const t of ask) if (!(t in INFO)) INFO[t] = { d: '', dab: false, missing: true };
    const bad = titles.filter((t) => !L.allowed(t, INFO[t]));
    if (!bad.length) return rounds;
    bad.forEach((t) => ban.add(t));
  }
  throw new Error('could not find ten articles to show');
}

async function start(practice) {
  const key = practice ? `${DAY}-practice-${Date.now().toString(36)}` : DAY;
  $('round').textContent = 'Choosing…';
  const rounds = await choose(key);
  game = { key, practice, rounds, picks: practice ? [] : store.get('wrm:' + DAY, []).slice(0, rounds.length) };
  $('daily').hidden = !practice;
  render();
}

function save() {
  if (game.practice) return;
  store.set('wrm:' + DAY, game.picks);
  if (game.picks.length === game.rounds.length && !PAST) {
    const days = store.get('wrm:days', []);
    if (!days.includes(DAY)) { days.push(DAY); store.set('wrm:days', days.slice(-400)); }
  }
}

const side = (i) => ({ t: CANDS[i].t, name: L.nice(CANDS[i].t), v: CANDS[i].v, d: INFO[CANDS[i].t].d });
const at = (k) => { const [i, j] = game.rounds[k]; return { a: side(i), b: side(j) }; };
const marks = () => game.picks.map((p, k) => { const { a, b } = at(k); return L.isRight(a.v, b.v, p); });
const wiki = (t) => `https://en.wikipedia.org/wiki/${encodeURIComponent(t)}`;

function render() {
  const k = game.picks.length, done = k >= game.rounds.length;
  const showing = game.showing ?? null;
  $('play').hidden = done && showing == null;
  $('end').hidden = !($('play').hidden);
  drawMarks(showing ?? k);
  if (!$('play').hidden) drawRound(showing ?? k, showing != null);
  if (!$('end').hidden) drawEnd();
}

function drawMarks(now) {
  const m = marks();
  $('marks').replaceChildren(...game.rounds.map((_, k) => {
    const li = document.createElement('li');
    if (k < m.length) { li.className = m[k] ? 'y' : 'n'; li.title = m[k] ? 'right' : 'wrong'; }
    if (k === now) li.classList.add('now');
    return li;
  }));
  $('marks').setAttribute('aria-label', `${m.filter(Boolean).length} right of ${m.length} so far`);
}

function drawRound(k, answered) {
  const { a, b } = at(k);
  $('round').textContent = `${game.practice ? 'Practice · ' : ''}Round ${k + 1} of ${game.rounds.length}`;
  const hi = L.higherIndex(a.v, b.v);
  const btns = [...$('pick').querySelectorAll('button')];
  [a, b].forEach((c, i) => {
    const el = btns[i];
    el.querySelector('b').textContent = c.name;
    el.querySelector('.desc').textContent = c.d;
    el.querySelector('.lat').textContent = answered ? L.views(c.v) : '';
    el.disabled = answered;
    el.classList.toggle('right', answered && hi === i);
    el.classList.toggle('wrong', answered && game.picks[k] === i && !L.isRight(a.v, b.v, i));
    el.setAttribute('aria-label', answered ? `${c.name}: ${L.views(c.v)}` : `${c.name}, ${c.d}`);
  });
  if (answered) {
    const right = L.isRight(a.v, b.v, game.picks[k]);
    const tag = document.createElement('b');
    tag.className = right ? 'y' : 'n';
    tag.textContent = right ? 'Right. ' : 'Not quite. ';
    $('out').replaceChildren(tag, L.verdict(a.name, a.v, b.name, b.v));
    drawBars(a, b);
    $('bars').hidden = false;
    $('next').hidden = false;
    $('next').textContent = k + 1 >= game.rounds.length ? 'See your score' : 'Next';
  } else {
    $('out').textContent = '';
    $('bars').hidden = true;
    $('next').hidden = true;
  }
}

function pick(i) {
  if (!game || game.showing != null || game.picks.length >= game.rounds.length) return;
  game.showing = game.picks.length;
  game.picks.push(i);
  save();
  render();
  $('next').focus({ preventScroll: true });
}

function next() {
  if (game.showing == null) return;
  game.showing = null;
  render();
  if (!$('play').hidden) $('pick').querySelector('button').focus({ preventScroll: true }); else $('share').focus({ preventScroll: true });
}

// Both days' views as bars from zero, so "five times as many" is something seen.
function drawBars(a, b) {
  const top = Math.max(a.v, b.v) || 1;
  const rows = [a, b].map((c, i) => {
    const row = document.createElement('div'); row.className = `row ${i ? 'b' : 'a'}`;
    const n = document.createElement('a'); n.href = wiki(c.t); n.textContent = c.name;
    const t = document.createElement('div'); t.className = 'track';
    const f = document.createElement('div'); f.className = 'fill'; f.style.width = `${Math.max(1, (100 * c.v) / top)}%`;
    t.append(f); row.append(n, t);
    return row;
  });
  const note = document.createElement('p'); note.className = 'note';
  const link = document.createElement('a');
  link.href = `https://pageviews.wmcloud.org/?project=en.wikipedia.org&platform=all-access&agent=user&start=${DAY}&end=${DAY}&pages=${encodeURIComponent(a.t)}|${encodeURIComponent(b.t)}`;
  link.textContent = 'Wikimedia pageviews';
  note.append(`Views on English Wikipedia, ${L.longDay(DAY)} (UTC), from `, link, '.');
  $('bars').replaceChildren(...rows, note);
}

function drawEnd() {
  const m = marks(), score = m.filter(Boolean).length;
  $('endday').textContent = game.practice ? 'Practice ten' : `Today's ten · read on ${L.longDay(DAY)}`;
  $('score').textContent = `${score} / ${m.length}`;
  const s = L.streak(store.get('wrm:days', []), DAY);
  $('streak').textContent = game.practice || PAST ? `${game.practice ? 'Practice rounds' : 'Earlier days'} do not count toward your streak.`
    : `${s === 1 ? 'First day of a streak' : `${s}-day streak`}. A new ten when the next day's numbers are out.`;
  $('share').hidden = game.practice;
  $('copied').textContent = '';
  $('recap').replaceChildren(...game.rounds.map((_, k) => {
    const { a, b } = at(k);
    const li = document.createElement('li');
    const mk = document.createElement('span'); mk.className = 'm ' + (m[k] ? 'y' : 'n'); mk.textContent = m[k] ? '✓' : '✗';
    mk.setAttribute('aria-label', m[k] ? 'right' : 'wrong');
    const [h, l] = L.higherIndex(a.v, b.v) === 0 ? [a, b] : [b, a];
    const t = document.createElement('span'); t.className = 't'; t.textContent = `${h.name} over ${l.name}`;
    const d = document.createElement('span'); d.className = 'd'; d.textContent = `${h.v.toLocaleString('en-US')} vs ${l.v.toLocaleString('en-US')}`;
    li.append(mk, t, d);
    return li;
  }));
}

async function share() {
  const text = L.shareText(DAY, marks()) + '\nhttps://matmat202.github.io/which-read-more/';
  try { await navigator.clipboard.writeText(text); $('copied').textContent = 'Copied.'; }
  catch { $('copied').textContent = text; }
}

const fail = (e) => {
  $('round').textContent = '';
  $('out').textContent = `Could not load Wikipedia's numbers (${e.message}). Reload to try again.`;
};
$('pick').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(Number(b.dataset.i)); });
$('next').addEventListener('click', next);
$('share').addEventListener('click', share);
$('practice').addEventListener('click', () => start(true).catch(fail));
$('daily').addEventListener('click', () => start(false).catch(fail));
document.addEventListener('keydown', (e) => {
  if (!game || e.metaKey || e.ctrlKey || e.altKey) return;
  if (game.showing == null && !$('play').hidden) {
    if (e.key === 'ArrowLeft' || e.key === '1') { e.preventDefault(); pick(0); }
    else if (e.key === 'ArrowRight' || e.key === '2') { e.preventDefault(); pick(1); }
  } else if (game.showing != null && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault(); next();
  }
});

loadLists().then(({ day, all, desk }) => {
  DAY = day; CANDS = L.candidates(all, desk);
  $('day').textContent = L.longDay(DAY);
  PAST = !!L.pickDay(new URLSearchParams(location.search).get('day'), Date.now());
  $('past').hidden = !PAST;
  return start(false);
}).catch(fail);
