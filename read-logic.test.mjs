// node site/read-logic.test.mjs — the page's pure logic on made-up lists, then on one real
// day's captured responses against test/facts.json, which test/facts.py computes from the
// same capture by its own reading of the rules. Exit 1 on any failure.
//   test/plant.sh   # mutates a copy of the logic; each mutant must FAIL this suite
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const L = await import(process.env.LOGIC ? pathToFileURL(process.env.LOGIC).href : './read-logic.js');
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL ${name} ${extra}`); } };
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
const list = (arts) => ({ items: [{ articles: arts.map(([article, views], k) => ({ article, views, rank: k + 1 })) }] });

// --- small pieces ----------------------------------------------------------------------
eq('hash is FNV-1a', [L.hash(''), L.hash('a')], [0x811c9dc5, 0xe40c292c]);
const r1 = L.rng(1), r2 = L.rng(1);
eq('rng repeats for a seed', [r1(), r1(), r1()], [r2(), r2(), r2()]);
eq('views', [L.views(1), L.views(1234567)], ['1 view', '1,234,567 views']);
eq('times', [L.times(30, 10), L.times(11, 10), L.times(140, 10), L.times(19.4, 10), L.times(1003, 1000), L.times(5, 0)],
  ['3.0 times as many', '10% more', '14 times as many', '94% more', '1% more', '']);
eq('verdict names the higher first', L.verdict('Al Pacino', 9000, 'Brazil', 41654),
  'Brazil: 41,654 views. Al Pacino: 9,000 views. 4.6 times as many.');
eq('right and wrong picks', [L.isRight(3, 2, 0), L.isRight(3, 2, 1), L.isRight(2, 3, 1), L.isRight(2, 2, 1)], [true, false, true, true]);
eq('the day to try: yesterday in UTC, then the day before', [L.utcDay(Date.parse('2026-10-27T00:30:00Z')), L.utcDay(Date.parse('2026-10-27T23:59:00Z')),
  L.utcDay(Date.parse('2026-10-27T00:30:00Z'), 2)], ['2026-10-26', '2026-10-26', '2026-10-25']);
const NOW = Date.parse('2026-10-27T08:00:00Z');
eq('a day from the URL', [L.pickDay('2026-10-26', NOW), L.pickDay('2015-07-01', NOW), L.pickDay('2026-10-27', NOW), L.pickDay('2015-06-30', NOW),
  L.pickDay('2026-02-30', NOW), L.pickDay('2026-1-5', NOW), L.pickDay(null, NOW), L.pickDay('2026-10-26x', NOW)],
  ['2026-10-26', '2015-07-01', null, null, null, null, null, null]);
eq('long day', L.longDay('2026-10-26'), 'Monday, October 26');
eq('top url', L.topURL('all-access', '2026-10-26'), 'https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/10/26');
const du = new URL(L.descriptionURL(['Al_Pacino', 'A&B']));
eq('description url asks for CORS, descriptions and disambiguation', [du.origin, du.searchParams.get('origin'), du.searchParams.get('prop'), du.searchParams.get('titles')],
  ['https://en.wikipedia.org', '*', 'description|pageprops', 'Al_Pacino|A&B']);
eq('share', L.shareText('2026-10-26', [true, false, true]), 'Which Read More? 2026-10-26: 2/3\n🟩🟥🟩');
eq('streak', [L.streak(['2026-10-24', '2026-10-25', '2026-10-26'], '2026-10-26'), L.streak(['2026-10-24', '2026-10-25'], '2026-10-26'),
  L.streak(['2026-10-23', '2026-10-25'], '2026-10-26'), L.streak([], '2026-10-26'), L.streak(['2026-02-28', '2026-03-01'], '2026-03-01')], [3, 2, 1, 0, 2]);

// --- the filters ---------------------------------------------------------------------------
const C = L.candidates(
  list([['Main_Page', 9e6], ['Special:Search', 8e5], ['Wikipedia:Featured_pictures', 7e5], ['User_talk:X', 6e5], ['Talk:Y', 5e5],
    ['Bot_page', 400000], ['Phone_page', 300000], ['Fine', 200000], ['Mostly_phone', 100000], ['Steins;Gate', 50000],
    ['Mission:_Impossible', 40000], ['Mid', 40000], ['Desk_heavy', 30000]]),
  list([['Main_Page', 5e6], ['User_talk:X', 3e5], ['Talk:Y', 2e5], ['Bot_page', 399000], ['Fine', 60000], ['Phone_page', 9000], ['Mission:_Impossible', 9000], ['Desk_heavy', 27500], ['Mid', 9000]]),
);
const names = C.map((c) => c.t);
ok('no Main_Page or other namespaces', !names.some((t) => /Main_Page|:Search|^Wikipedia:|^User_talk:|^Talk:/.test(t)), names);
ok('a title with a colon is still an article', names.includes('Mission:_Impossible'), names);
ok('99.75% desktop is dropped, 91.7% too', !names.includes('Bot_page') && !names.includes('Desk_heavy'), names);
ok('3% desktop is dropped', !names.includes('Phone_page'), names);
ok('missing from the desktop list is not 0% desktop: kept while the floor allows 5%', names.includes('Mostly_phone') && names.includes('Steins;Gate'), names);
eq('most-read first, ties by title', names, ['Fine', 'Mostly_phone', 'Steins;Gate', 'Mid', 'Mission:_Impossible']);
eq('desktop share known or null', C.map((c) => c.desk), [0.3, null, null, 0.225, 0.225]);
eq('nothing from nothing', L.candidates(null, undefined), []);
ok('missing from desktop when the floor rules out 5%: dropped', !L.candidates(list([['Huge', 1e6]]), list([['Other', 20000]])).length);

const A = (d, extra = {}) => ({ d, dab: false, missing: false, ...extra });
eq('allowed: a plain article', L.allowed('Al_Pacino', A('American actor (born 1940)')), true);
eq('allowed: not without a description, not a disambiguation, not missing',
  [L.allowed('X', A('')), L.allowed('Sex', A('Topics referred to by the same term', { dab: true })), L.allowed('Gone', A('x', { missing: true })), L.allowed('Q', undefined)],
  [false, false, false, false]);
const blocked = [['Bonnie_Blue', 'English pornographic film actress (born 1999)'], ['Ted_Bundy', 'American serial killer (1946–1989)'],
  ['Aaron_Hernandez', 'American football player and murderer (1989–2017)'], ['XNXX', 'Czech-pornographic website'], ['.xxx', 'Internet top-level domain'],
  ['West_Nickel_Mines_School_shooting', '2006 mass shooting in Pennsylvania, U.S.'], ['Suicide_methods', 'Means by which a person dies by suicide'],
  ['September_11_attacks', '2001 terror attacks in the U.S.'], ['Jeffrey_Epstein', 'American financier and child sex offender (1953–2019)'],
  ['Coprophilia', 'Sexual paraphilia involving feces'], ['Deaths_in_2026', 'List'], ['Killing_of_the_Clancy_children', '2023 triple filicide'],
  ['Amiet_market_massacre', '2026 airstrike in Abyei'], ['Aberfan_disaster', '1966 Welsh colliery disaster'], ['Some_film', 'Erotic thriller'],
  ['Someone', 'American rapist'], ['A_model', 'Adult model'], ['Nude_beach', 'Beach'], ['Escort_(film)', '2026 film'], ['Death_of_X', '2026 event'],
  ['Assassination_of_Y', 'Killing of a politician'], ['Brasília_attack', 'Storming'], ['Canopy', 'Station canopy collapse'], ['Abuse', 'x']];
eq('blocked, by title or description', blocked.filter(([t, d]) => L.allowed(t, A(d))).map(([t]) => t), []);
const kept = [['Meghan,_Duchess_of_Sussex', 'American member of the British royal family (born 1981)'], ['Adultery_(TV_series)', 'British television series'],
  ['XXXTentacion', 'American rapper and singer-songwriter (1998–2018)'], ['XXXX_(beer)', 'Australian brand of beer'], ['World_War_II', 'Global conflict from 1939 to 1945'],
  ['Essex', 'County of England'], ['Grapefruit', 'Citrus fruit'], ['The_Rapture', 'Christian belief']];
eq('kept: near misses are not blocked', kept.filter(([t, d]) => !L.allowed(t, A(d))).map(([t]) => t), []);

const api = { query: { normalized: [{ from: 'Al_Pacino', to: 'Al Pacino' }, { from: 'USA', to: 'USA' }],
  redirects: [{ from: 'USA', to: 'United States' }],
  pages: [{ title: 'Al Pacino', description: 'American actor' }, { title: 'United States', description: 'Country', pageprops: {} },
    { title: 'Sex', description: 'Topics', pageprops: { disambiguation: '' } }, { title: 'Nope', missing: true }] } };
eq('descriptions map back to the titles asked', L.readDescriptions(api), {
  Al_Pacino: { d: 'American actor', dab: false, missing: false }, USA: { d: 'Country', dab: false, missing: false },
  Sex: { d: 'Topics', dab: true, missing: false }, Nope: { d: '', dab: false, missing: true } });
eq('descriptions from nothing', L.readDescriptions(undefined), {});

// --- the day's ten on a made-up list ------------------------------------------------------
const fake = Array.from({ length: 900 }, (_, i) => ({ t: `T${i}`, v: Math.round(2e6 * Math.exp(-i / 120)) + 8000 }));
const day = L.roundsFor(fake, '2026-10-26');
eq('ten rounds', day.length, 10);
eq('the same day gives the same ten', L.roundsFor(fake, '2026-10-26'), day);
ok('another day gives another ten', JSON.stringify(L.roundsFor(fake, '2026-10-27')) !== JSON.stringify(day));
eq('nothing twice in a day', new Set(day.flat()).size, 20);
const ratio = ([i, j]) => Math.max(fake[i].v, fake[j].v) / Math.min(fake[i].v, fake[j].v);
eq('every pair is in its band', day.map((p, k) => ratio(p) >= L.BANDS[k][0] && ratio(p) <= L.BANDS[k][1]), Array(10).fill(true));
const banned = new Set(L.titlesOf(fake, day).slice(0, 5));
const again = L.roundsFor(fake, '2026-10-26', banned);
ok('banned titles never come back', !L.titlesOf(fake, again).some((t) => banned.has(t)) && again.length === 10, L.titlesOf(fake, again));
const many = Array.from({ length: 40 }, (_, k) => L.roundsFor(fake, `s${k}`)).flat();
const sides = many.map(([i, j]) => L.higherIndex(fake[i].v, fake[j].v));
ok('the more-read one is on either side', sides.filter((s) => s === 0).length > 120 && sides.filter((s) => s === 1).length > 120, sides.filter((s) => s === 0).length);
const at = many.flat(), median = at.slice().sort((a, b) => a - b)[at.length >> 1];
ok('picks lean to the most read (median in the top 40%)', median < 900 * 0.4, median);
ok('but reach the tail', Math.max(...at) > 900 * 0.8, Math.max(...at));
eq('fits refuses equal views', L.fits({ v: 5 }, { v: 5 }, [1, 9]), false);
eq('a list too small for ten gives what it can', L.roundsFor([{ t: 'a', v: 9 }, { t: 'b', v: 1 }, { t: 'c', v: 3 }], 'x').length, 1);

// --- one real day ---------------------------------------------------------------------------
// data/ sits beside site/ here and beside this file in the published copy.
const fix = existsSync(here('./data/2026-10-26/all.json')) ? here('./data/2026-10-26/') : here('../data/2026-10-26/'), factFile = existsSync(here('./facts.json')) ? here('./facts.json') : here('../test/facts.json');
if (existsSync(fix + 'all.json') && existsSync(factFile)) {
  const read = (f) => JSON.parse(readFileSync(fix + f, 'utf8'));
  const F = JSON.parse(readFileSync(factFile, 'utf8'));
  const D = read('desc.json');
  const real = L.candidates(read('all.json'), read('desktop.json'));
  eq('real: candidates as facts.py counts them', real.length, F.candidates);
  const shown = real.filter((c) => L.allowed(c.t, D[c.t])).map((c) => c.t);
  eq('real: the showable articles are exactly facts.py\'s, in order', shown, F.shown);
  ok('real: enough for a daily ten many times over', shown.length >= 200, shown.length);
  eq('real: views as the list has them', real.slice(0, 50).every((c) => F.views[c.t] === c.v), true);
  // Read off the capture by eye, 2026-10-27.
  for (const t of ['Limonene', 'JSON-LD', 'Neatsville,_Kentucky', '.xxx']) ok(`real: ${t} dropped on its desktop share`, F.dropped_share.includes(t) && !real.some((c) => c.t === t));
  for (const t of ['Bonnie_Blue', 'XNXX', 'Pornhub', 'Ted_Bundy', 'Main_Page', 'Special:Search']) ok(`real: ${t} never shown`, !shown.includes(t));
  for (const t of ['Brazil', 'World_War_II', 'Javier_Milei']) ok(`real: ${t} shown`, shown.includes(t));
  const pool = real.filter((c) => L.allowed(c.t, D[c.t]));
  const days = Array.from({ length: 60 }, (_, k) => L.roundsFor(pool, `2026-11-${k}`));
  eq('real: 60 seeds of full tens', days.every((d) => d.length === 10), true);
  eq('real: every pair in its band', days.every((d) => d.every(([i, j], k) => L.fits(pool[i], pool[j], L.BANDS[k]))), true);
  // The page's own loop: choose from every candidate, ban what fails, choose again.
  let ban = new Set(), rounds, tries = 0;
  for (; tries < 8; tries++) {
    rounds = L.roundsFor(real, '2026-10-26', ban);
    const bad = L.titlesOf(real, rounds).filter((t) => !L.allowed(t, D[t]));
    if (!bad.length) break;
    bad.forEach((t) => ban.add(t));
  }
  ok('real: the ban loop settles, on ten showable pairs', tries < 8 && rounds.length === 10 && L.titlesOf(real, rounds).every((t) => L.allowed(t, D[t])), tries);
} else ok('real: data/2026-10-26/ and test/facts.json exist (run capture.py, test/facts.py)', false);

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
