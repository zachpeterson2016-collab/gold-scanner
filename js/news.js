/* News schedule (Chicago time). The few US releases that move gold hard enough to blow through a 15m stop:
   FOMC decisions, NFP and CPI (hard-coded dates, verified Oct 2026) plus calendar-rule events (ISM PMIs, weekly jobless
   claims, FOMC minutes). No key-free economic-calendar API is reachable from a plain web page, so this is the "red folder";
   one-off events (Fed speeches, surprise releases) can be added by hand and are kept in this browser. */
const News = (() => {
  const MIN = 60000, DAY = 86400000, LS = 'gs_news_v1';
  // Statement 1:00 PM CT, press conference 1:30–2:15 PM CT → stay out from 12:45 to 2:00 PM
  const FOMC = ['2026-10-28', '2026-12-09', '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08'];
  const NFP = ['2026-10-02', '2026-11-06', '2026-12-04'];       // 7:30 AM CT · 2027 dates follow the first-Friday rule until BLS publishes them
  const CPI = ['2026-10-14', '2026-11-10', '2026-12-10'];       // 7:30 AM CT · 2027 schedule not published yet
  const HOL = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-10-11', '2027-11-11', '2027-11-25', '2027-12-24']);
  const WIN = { red: [15, 15], orange: [10, 10], fomc: [15, 60] };   // minutes before / after

  // ---- Chicago wall clock ↔ ms -------------------------------------------------------------------------------------
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' });
  function wall(ms) { const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute }; }
  const asUTC = w => Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
  // ms for a Chicago wall-clock time (two passes so a DST switch between the guess and the answer is corrected)
  function ctToMs(y, m, d, h, mi) {
    const want = Date.UTC(y, m - 1, d, h, mi);
    let t = want + (want - asUTC(wall(want)));
    if (asUTC(wall(t)) !== want) t = want + (t - asUTC(wall(t)));
    return t;
  }
  const key = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const parseKey = k => k.split('-').map(Number);
  const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const isBiz = (y, m, d) => { const w = dow(y, m, d); return w > 0 && w < 6 && !HOL.has(key(y, m, d)); };
  const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  function nthBiz(y, m, n) { let c = 0; for (let d = 1; d <= dim(y, m); d++) if (isBiz(y, m, d) && ++c === n) return d; return null; }
  function firstDow(y, m, w) { for (let d = 1; d <= 7; d++) if (dow(y, m, d) === w) return d; }
  const addDays = (y, m, d, n) => { const t = new Date(Date.UTC(y, m - 1, d + n)); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; };

  // ---- event generation ----------------------------------------------------------------------------------------------
  const ev = (y, m, d, h, mi, name, impact, win, est) => ({ t: ctToMs(y, m, d, h, mi), name, impact, before: win[0] * MIN, after: win[1] * MIN, est: !!est });
  function monthEvents(y, m) {
    const out = [];
    const b1 = nthBiz(y, m, 1), b3 = nthBiz(y, m, 3);
    if (b1) out.push(ev(y, m, b1, 9, 0, 'ISM Manufacturing PMI', 'orange', WIN.orange));
    if (b3) out.push(ev(y, m, b3, 9, 0, 'ISM Services PMI', 'orange', WIN.orange));
    if (y >= 2027) {   // NFP first-Friday rule (a holiday Friday pushes it a week) — flagged as unconfirmed
      let f = firstDow(y, m, 5); if (HOL.has(key(y, m, f))) f += 7;
      out.push(ev(y, m, f, 7, 30, 'NFP (date unconfirmed)', 'red', WIN.red, true));
    }
    return out;
  }
  function fixedEvents() {
    const out = [];
    for (const k of FOMC) { const [y, m, d] = parseKey(k); out.push(ev(y, m, d, 13, 0, 'FOMC rate decision + presser', 'red', WIN.fomc)); const [my, mm, md] = addDays(y, m, d, 21); out.push(ev(my, mm, md, 13, 0, 'FOMC minutes', 'orange', WIN.orange)); }
    for (const k of NFP) { const [y, m, d] = parseKey(k); out.push(ev(y, m, d, 7, 30, 'NFP jobs report', 'red', WIN.red)); }
    for (const k of CPI) { const [y, m, d] = parseKey(k); out.push(ev(y, m, d, 7, 30, 'CPI inflation', 'red', WIN.red)); }
    return out;
  }
  function dayEvents(y, m, d) {
    const w = dow(y, m, d), out = [];
    // weekly jobless claims: Thursday 7:30 AM CT, Wednesday when Thursday is a holiday
    if (w === 4 && !HOL.has(key(y, m, d))) out.push(ev(y, m, d, 7, 30, 'Jobless claims', 'orange', WIN.orange));
    if (w === 3) { const [ty, tm, td] = addDays(y, m, d, 1); if (HOL.has(key(ty, tm, td))) out.push(ev(y, m, d, 7, 30, 'Jobless claims', 'orange', WIN.orange)); }
    return out;
  }
  function manual() { try { return (JSON.parse(localStorage.getItem(LS) || '[]')).map(x => ({ t: x.t, name: x.name, impact: 'red', before: WIN.red[0] * MIN, after: WIN.red[1] * MIN, est: false, manual: true })); } catch (e) { return []; } }
  function addManual(t, name) { const list = manual().filter(x => !(x.t === t && x.name === name)).map(x => ({ t: x.t, name: x.name })); list.push({ t, name: String(name || 'news').slice(0, 40) }); localStorage.setItem(LS, JSON.stringify(list.sort((a, b) => a.t - b.t).slice(-50))); }
  function removeManual(t, name) { localStorage.setItem(LS, JSON.stringify(manual().filter(x => !(x.t === t && x.name === name)).map(x => ({ t: x.t, name: x.name })))); }

  const cache = new Map();
  // All events with t in [from, to], sorted; red beats orange on the same minute.
  function upcoming(from, to) {
    const ck = `${Math.floor(from / MIN)}|${Math.floor(to / MIN)}|${localStorage.getItem(LS) || ''}`;
    if (cache.has(ck)) return cache.get(ck);
    const a = wall(from), b = wall(to), out = [...fixedEvents(), ...manual()];
    for (let y = a.y, m = a.m; y < b.y || (y === b.y && m <= b.m); m === 12 ? (y++, m = 1) : m++) out.push(...monthEvents(y, m));
    for (let t = Date.UTC(a.y, a.m - 1, a.d); t <= Date.UTC(b.y, b.m - 1, b.d); t += DAY) { const dd = new Date(t); out.push(...dayEvents(dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate())); }
    const seen = new Set(), res = out.filter(e => e.t >= from && e.t <= to && !seen.has(e.t + e.name) && seen.add(e.t + e.name)).sort((x, y) => x.t - y.t || (x.impact === 'red' ? -1 : 1));
    if (cache.size > 20) cache.clear();
    cache.set(ck, res); return res;
  }
  // The event whose no-trade window contains `now` (red first), or null.
  function block(now) {
    const list = upcoming(now - 3 * 3600000, now + 3 * 3600000).filter(e => now >= e.t - e.before && now <= e.t + e.after);
    if (!list.length) return null;
    list.sort((x, y) => (x.impact === y.impact ? 0 : x.impact === 'red' ? -1 : 1) || (x.t + x.after) - (y.t + y.after));
    const e = list[0]; return { ev: e, until: Math.max(...list.map(x => x.t + x.after)) };
  }
  // Next event after `now` (within 10 days), with minutes to go.
  function next(now) {
    const e = upcoming(now, now + 10 * DAY).find(x => x.t > now);
    return e ? { ev: e, inMin: Math.round((e.t - now) / MIN) } : null;
  }
  // true when the hard-coded red-folder dates run out within 3 weeks — time to add the newly published ones
  function stale(now) {
    const last = Math.max(...[...NFP, ...CPI].map(k => { const [y, m, d] = parseKey(k); return ctToMs(y, m, d, 7, 30); }));
    return now > last - 21 * DAY;
  }
  const fmtHM = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
  return { upcoming, block, next, stale, manual, addManual, removeManual, ctToMs, wall, WIN, fmtHM: ms => fmtHM.format(new Date(ms)) };
})();
