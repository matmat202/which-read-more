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

// Yesterday in UTC, or the day before while yesterday's lists are not out yet. A day
// asked for in the URL is an earlier day only if it is older than that; when it is the
// day before yesterday, whether yesterday is out decides, so it is asked alongside.
async function loadLists() {
  const now = Date.now();
  const asked = L.pickDay(new URLSearchParams(location.search).get('day'), now);
  const probe = asked === L.utcDay(now, 2)
    ? getJSON(L.topURL('all-access', L.utcDay(now, 1))).then(() => true, (e) => e.status !== 404) : null;
  let last;
  for (const back of asked ? [0] : [1, 2, 3]) {
    const day = asked || L.utcDay(now, back);
    try {
      const [all, desk, out] = await Promise.all([getJSON(L.topURL('all-access', day)), getJSON(L.topURL('desktop', day)), probe ?? true]);
      return { day, all, desk, past: !!asked && L.isPast(day, now, out) };
    } catch (e) { last = e; if (e.status !== 404) break; }
  }
  throw last;
}

// Choose the ten, look up what has not been looked up, ban what may not be shown, choose
// again. The choice depends only on the lists and the bans, so everyone gets the same ten.
// Every candidate is described up front, in one parallel wave. Asking only for the drawn
// twenty cost a round trip per redraw: a ban reshuffles every later round, so a typical
// first ten waited on five requests in series (2026-11-21, live). ~20 requests of 50
// titles, ~50 KB gzipped, and a practice ten then needs no request at all.
async function describe(titles) {
  const ask = [...new Set(titles)].filter((t) => !(t in INFO));
  const batches = [];
  for (let k = 0; k < ask.length; k += 50) batches.push(ask.slice(k, k + 50));
  for (const json of await Promise.all(batches.map((b) => getJSON(L.descriptionURL(b))))) Object.assign(INFO, L.readDescriptions(json));
  for (const t of ask) if (!(t in INFO)) INFO[t] = { d: '', dab: false, missing: true };
}

async function choose(seed) {
  const ban = new Set();
  await describe(CANDS.map((c) => c.t));
  for (let tries = 0; tries < 8; tries++) {
    const rounds = L.roundsFor(CANDS, seed, ban);
    const titles = L.titlesOf(CANDS, rounds);
    await describe(titles); // a no-op once the wave is in; kept so a draw never shows an unlooked-up title
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
  // `?day=` games said "Today's ten" too, on a day that was not today's.
  $('endday').textContent = game.practice ? 'Practice ten' : `${PAST ? 'An earlier' : "Today's"} ten · read on ${L.longDay(DAY)}`;
  $('score').textContent = `${score} / ${m.length}`;
  // Every finished day goes on the record, earlier days included: the streak is about
  // coming back, the record about how good you are. Written here rather than in save() so
  // a day finished before the record existed is counted the next time its end is shown.
  const scores = store.get('wrm:scores', {});
  if (!game.practice && m.length === game.rounds.length) { scores[DAY] = score; store.set('wrm:scores', scores); }
  $('record').textContent = game.practice ? '' : L.recordText(L.record(scores));
  const s = L.streak(store.get('wrm:days', []), DAY);
  $('streak').textContent = game.practice || PAST ? `${game.practice ? 'Practice rounds' : 'Earlier days'} do not count toward your streak.`
    : `${s === 1 ? 'First day of a streak' : `${s}-day streak`}. A new ten when the next day's numbers are out.`;
  $('share').hidden = game.practice;
  // The way to more real days. ?day= already worked, but only the footer said so; a finished
  // player now steps back one day at a time, and earlier days stay out of the streak.
  const prev = L.dayBefore(DAY);
  $('before').hidden = !prev;
  if (prev) { $('before').href = `?day=${prev}`; $('before').textContent = `← Play ${L.longDay(prev).split(',')[0]}'s ten`; }
  // And forward again: a player who stepped back three days had only "the latest ten".
  const nxt = PAST ? L.dayAfter(DAY, Date.now()) : null;
  $('after').hidden = !nxt;
  if (nxt) { $('after').href = `?day=${nxt}`; $('after').textContent = `Play ${L.longDay(nxt).split(',')[0]}'s ten →`; }
  $('share').textContent = sheet() ? 'Share result' : 'Copy result';
  $('copied').textContent = '';
  $('recap').replaceChildren(...game.rounds.map((_, k) => {
    const { a, b } = at(k);
    const li = document.createElement('li');
    const mk = document.createElement('span'); mk.className = 'm ' + (m[k] ? 'y' : 'n'); mk.textContent = m[k] ? '✓' : '✗';
    mk.setAttribute('aria-label', m[k] ? 'right' : 'wrong');
    const [h, l] = L.higherIndex(a.v, b.v) === 0 ? [a, b] : [b, a];
    // Each name links to its article: the recap is where all ten pairs stay, and the one
    // place a player can go and find out why Kaviya Maran had 101,460 readers.
    const link = (c) => { const n = document.createElement('a'); n.href = wiki(c.t); n.textContent = c.name; return n; };
    const t = document.createElement('span'); t.className = 't'; t.append(link(h), ' over ', link(l));
    const d = document.createElement('span'); d.className = 'd'; d.textContent = `${h.v.toLocaleString('en-US')} vs ${l.v.toLocaleString('en-US')}`;
    li.append(mk, t, d);
    return li;
  }));
}

// On a phone the share sheet hands the result straight to Messages; copying made the player
// switch apps and paste. Desktop browsers that have navigator.share open a clumsy system
// dialog for it, so a mouse keeps the clipboard. Cancelling the sheet is not a failure.
const sheet = () => typeof navigator.share === 'function' && matchMedia('(pointer: coarse)').matches;
async function share() {
  const text = L.shareText(DAY, marks()) + '\n' + L.shareURL(DAY);
  $('copied').textContent = '';
  if (sheet()) {
    try { await navigator.share({ text }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
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

loadLists().then(({ day, all, desk, past }) => {
  DAY = day; CANDS = L.candidates(all, desk);
  $('day').textContent = L.longDay(DAY);
  PAST = past;
  $('past').hidden = !PAST;
  return start(false);
}).catch(fail);
