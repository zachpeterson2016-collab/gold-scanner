/* Data layer: PAXG/USD candles from Coinbase (CORS-open, no key) + live spot gold from gold-api.com.
   Candle = {t (ms, bucket start UTC), o, h, l, c, v}. Arrays are ascending by time. */
const Data = (() => {
  const CB = 'https://api.exchange.coinbase.com/products/PAXG-USD/candles';
  const SPOT = 'https://api.gold-api.com/price/XAU';
  const GRAN = { '15m': 900, '1h': 3600, '1d': 86400 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function fetchChunk(tf, startSec, endSec) {
    const g = GRAN[tf];
    const url = `${CB}?granularity=${g}&start=${new Date(startSec * 1000).toISOString()}&end=${new Date(endSec * 1000).toISOString()}`;
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('Coinbase HTTP ' + r.status);
    const rows = await r.json();
    return rows.map(x => ({ t: x[0] * 1000, l: +x[1], h: +x[2], o: +x[3], c: +x[4], v: +x[5] }));
  }

  function normalize(rows) {
    const m = new Map();
    rows.forEach(r => m.set(r.t, r));
    return [...m.values()].sort((a, b) => a.t - b.t);
  }

  // Pull `count` candles back from now, 300 per request.
  async function fetchHistory(tf, count, onProgress) {
    const g = GRAN[tf];
    let end = Math.floor(Date.now() / 1000) + g;
    let out = [];
    let guard = 0;
    while (out.length < count && guard++ < 40) {
      const start = end - 300 * g;
      const rows = await fetchChunk(tf, start, end);
      out = out.concat(rows);
      end = start;
      if (onProgress) onProgress(tf, out.length, count);
      if (!rows.length && guard > 3) break;
      await sleep(130);
    }
    return normalize(out);
  }

  async function fetchLatest(tf) {
    const g = GRAN[tf];
    const end = Math.floor(Date.now() / 1000) + g;
    return normalize(await fetchChunk(tf, end - 300 * g, end));
  }

  function merge(oldArr, newArr) { return normalize((oldArr || []).concat(newArr || [])); }

  /* ---- Deep daily history (for the 1Y / 5Y views) ----
     Coinbase only lists PAXG since May 2025, so older UTC days come from Crypto.com (PAXG/USD, Oct 2022 →) and
     Binance.US (PAXG/USD, Sep 2020 → Jun 2023; PAXG/USDT as a spare). Each source is scaled by its median close ratio over
     the overlap with what we already have (seamless splice), wick spikes are clipped to ±3% of the body, bad prints are
     swapped for the other source's bar (see despike), and a source that would leave a hole is skipped. Cached for a week. */
  const DEEP_KEY = 'gs_deep1d_v1', DEEP_TTL = 7 * 86400000, DAY = 86400000;
  const rnd = v => Math.round(v * 100) / 100;
  async function fetchJSON(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
  const DEEP_SOURCES = [
    { name: 'crypto.com', async fetch(minT) {
      let end = Date.now(), out = [];
      for (let k = 0; k < 10; k++) {
        const j = await fetchJSON(`https://api.crypto.com/exchange/v1/public/get-candlestick?instrument_name=PAXG_USD&timeframe=1D&count=300&end_ts=${end}`);
        const rows = (j.result && j.result.data) || []; if (!rows.length) break;
        out = out.concat(rows.map(x => ({ t: +x.t, o: +x.o, h: +x.h, l: +x.l, c: +x.c, v: +x.v })));
        end = +rows[0].t; if (rows.length < 300 || end <= minT) break;
        await sleep(120);
      }
      return normalize(out);
    } },
    { name: 'binance.us', async fetch(minT) { return binanceUS('PAXGUSD', minT); } },
    { name: 'binance.us (USDT)', async fetch(minT) { return binanceUS('PAXGUSDT', minT); } },
  ];
  async function binanceUS(sym, minT) {
    let end = Date.now(), out = [];
    for (let k = 0; k < 4; k++) {
      const rows = await fetchJSON(`https://api.binance.us/api/v3/klines?symbol=${sym}&interval=1d&limit=1000&endTime=${end}`);
      if (!Array.isArray(rows) || !rows.length) break;
      out = out.concat(rows.map(x => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] })));
      end = +rows[0][0] - 1; if (rows.length < 1000 || end <= minT) break;
      await sleep(120);
    }
    return normalize(out);
  }
  // Median close ratio series/rows over their overlap (null when there is no overlap or the prices do not line up).
  function scaleTo(series, rows) {
    const have = new Map(series.map(b => [b.t, b.c]));
    const ratios = rows.filter(r => have.has(r.t) && r.c > 0).map(r => have.get(r.t) / r.c).sort((a, b) => a - b);
    if (ratios.length < 10) return null;
    const k = ratios[ratios.length >> 1];
    return Math.abs(k - 1) > 0.03 ? null : k;
  }
  const scaled = (r, k, name) => { const o = r.o * k, c = r.c * k, hi = Math.max(o, c), lo = Math.min(o, c); return { t: r.t, o: rnd(o), h: rnd(Math.min(r.h * k, hi * 1.03)), l: rnd(Math.max(r.l * k, lo * 0.97)), c: rnd(c), v: r.v, src: name }; };
  // Thin-market bad prints: a close more than 3% away from the median of its six neighbours is swapped for another
  // source's bar for that day when that one sits closer to the neighbours; with no alternative only wild (> 6%) prints are bridged.
  function despike(series, first, pools) {
    const closes = series.map(b => b.c);
    const out = series.map((b, i) => {
      if (b.t >= first) return b;
      const nb = []; for (let j = i - 3; j <= i + 3; j++) if (j !== i && j >= 0 && j < closes.length) nb.push(closes[j]);
      nb.sort((x, y) => x - y); const ref = nb[nb.length >> 1], dev = Math.abs(b.c / ref - 1);
      if (dev <= 0.03) return b;
      let best = b, bestDev = dev;
      for (const p of pools) { const a = p.get(b.t); if (a && a.src !== b.src) { const d = Math.abs(a.c / ref - 1); if (d < bestDev) { best = a; bestDev = d; } } }
      if (best !== b) return Object.assign({}, best, { fix: 'alt' });
      if (dev > 0.06) { const o = i ? closes[i - 1] : ref; return { t: b.t, o: rnd(o), h: rnd(Math.max(o, ref) * 1.005), l: rnd(Math.min(o, ref) * 0.995), c: rnd(ref), v: b.v, src: b.src, fix: 'bridged' }; }
      return b;
    });
    // 24/7 market: a day opens where the previous one closed, so a stale open (> 1% off) is snapped back onto it
    for (let i = 1; i < out.length && out[i].t < first; i++) {
      const b = out[i], o = out[i - 1].c;
      if (Math.abs(b.o / o - 1) <= 0.01) continue;
      const hi = Math.max(o, b.c), lo = Math.min(o, b.c);
      out[i] = Object.assign({}, b, { o: rnd(o), h: rnd(Math.min(Math.max(b.h, hi), hi * 1.03)), l: rnd(Math.max(Math.min(b.l, lo), lo * 0.97)) });
    }
    return out;
  }
  // Returns the daily series extended backwards (≈ 6 years). `existing` = ascending Coinbase daily candles.
  async function deepDaily(existing, maxDays = 2300) {
    if (!existing || !existing.length) return existing || [];
    const first = existing[0].t;
    try {
      const c = JSON.parse(localStorage.getItem(DEEP_KEY) || 'null');
      const older = c && Date.now() - c.at < DEEP_TTL && Array.isArray(c.bars) ? c.bars.filter(b => b.t < first) : [];
      if (older.length && first - older[older.length - 1].t <= 5 * DAY) return normalize(older.concat(existing));
    } catch (e) { }
    let series = existing.slice(); const minT = Date.now() - maxDays * DAY, used = [], pools = [];
    for (const s of DEEP_SOURCES) {
      try {
        const rows = await s.fetch(minT), k = scaleTo(series, rows);
        if (k === null) throw new Error('no overlap, or prices do not line up');
        const pool = new Map(rows.filter(r => r.c > 0).map(r => [r.t, scaled(r, k, s.name)])); pools.push(pool);
        const older = rows.filter(r => r.t < series[0].t && r.c > 0);
        if (!older.length) continue;
        if (series[0].t - older[older.length - 1].t > 5 * DAY) throw new Error('would leave a gap before ' + new Date(series[0].t).toISOString().slice(0, 10));
        series = older.map(r => pool.get(r.t)).concat(series); used.push(s.name);
      } catch (e) { console.warn(`deep daily history: ${s.name} skipped — ${e.message}`); }
    }
    series = despike(series, first, pools);
    const older = series.filter(b => b.t < first);
    if (older.length) try { localStorage.setItem(DEEP_KEY, JSON.stringify({ at: Date.now(), first, used, bars: older })); } catch (e) { }
    return series;
  }

  /* ---- Deep intraday history (15m / 1H) ----
     Coinbase serves PAXG-USD candles back to its May 2025 listing, 300 per request. We page backwards from the oldest bar we
     hold until `target` bars (or the listing) is reached, then keep the whole series in localStorage as compact rows so the
     next start is instant. The 7-day TTL guarantees the cache still overlaps the fresh 6000-bar load (≈ 60 days). */
  const IKEY = { '15m': 'gs_deep15m_v1', '1h': 'gs_deep1h_v1' };
  const pack = b => [b.t, rnd(b.o), rnd(b.h), rnd(b.l), rnd(b.c), Math.round(b.v * 1000) / 1000];
  const unpack = r => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] });
  function readIntraday(tf) {
    try {
      const c = JSON.parse(localStorage.getItem(IKEY[tf]) || 'null');
      return c && Date.now() - c.at < DEEP_TTL && Array.isArray(c.bars) ? c.bars.map(unpack) : [];
    } catch (e) { return []; }
  }
  // Returns `existing` (ascending Coinbase candles) extended backwards to ≈ `target` bars.
  async function deepIntraday(tf, existing, target, onProgress) {
    if (!existing || !existing.length) return existing || [];
    const g = GRAN[tf], gms = g * 1000, cached = readIntraday(tf);
    let series = existing.slice();
    // a cached series is only usable when it overlaps (or touches) what we hold — otherwise it would leave a hole
    if (cached.length && existing[0].t - cached[cached.length - 1].t <= 2 * gms) series = normalize(cached.concat(existing));
    let end = Math.floor(series[0].t / 1000), empty = 0, guard = 0;
    while (series.length < target && guard++ < 220) {
      const start = end - 300 * g;
      let rows;
      try { rows = await fetchChunk(tf, start, end - g); }
      catch (e) { if (/429|5\d\d/.test(e.message) && guard < 200) { await sleep(2500); continue; } throw e; }
      if (!rows.length) { if (++empty >= 3) break; } else { empty = 0; series = rows.concat(series); }
      end = start;
      if (onProgress) onProgress(tf, series.length, target);
      await sleep(150);
    }
    series = normalize(series);
    try { localStorage.setItem(IKEY[tf], JSON.stringify({ at: Date.now(), bars: series.slice(-target).map(pack) })); } catch (e) { console.warn('intraday cache not saved', e.message); }
    return series;
  }

  async function fetchSpot() {
    const r = await fetch(SPOT, { cache: 'no-store' });
    if (!r.ok) throw new Error('spot HTTP ' + r.status);
    const j = await r.json();
    return { price: +j.price, at: Date.parse(j.updatedAt) || Date.now() };
  }

  /* ---- Market-hours helpers (gold CFD on TradeLocker: closed Fri 16:00 CT → Sun 17:00 CT, and 16:00–17:00 CT daily) ---- */
  const fmtCT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false });
  // Keyed by UTC hour (Chicago offsets are whole hours), so 50k candles need only ~12k Intl calls instead of thrashing a per-ms cache.
  const ctCache = new Map();
  function ctParts(ms) {
    const hb = Math.floor(ms / 3600000);
    let v = ctCache.get(hb);
    if (!v) {
      const p = Object.fromEntries(fmtCT.formatToParts(new Date(hb * 3600000)).map(x => [x.type, x.value]));
      v = { wd: p.weekday, h: (+p.hour) % 24 };
      if (ctCache.size > 60000) ctCache.clear();
      ctCache.set(hb, v);
    }
    return { wd: v.wd, h: v.h, m: Math.floor(ms / 60000) % 60 };
  }
  function isOpen(ms) {
    const { wd, h } = ctParts(ms);
    if (wd === 'Sat') return false;
    if (wd === 'Fri' && h >= 16) return false;
    if (wd === 'Sun' && h < 17) return false;
    if (h === 16) return false;
    return true;
  }
  function filterOpen(candles, tf) {
    if (tf === '1d') return candles.filter(x => { const d = new Date(x.t).getUTCDay(); return d !== 0 && d !== 6; });
    return candles.filter(x => isOpen(x.t));
  }
  // Next market open (ms) if currently closed, else null.
  function nextOpen(nowMs) {
    if (isOpen(nowMs)) return null;
    let t = Math.floor(nowMs / 60000) * 60000;
    for (let i = 0; i < 60 * 24 * 3; i++) { t += 60000; if (isOpen(t)) return t; }
    return null;
  }
  // Session label in Chicago time.
  function session(ms) {
    if (!isOpen(ms)) return { name: 'Closed', kz: false };
    const { h, m } = ctParts(ms);
    const hm = h + m / 60;
    if (hm >= 2 && hm < 5) return { name: 'London KZ', kz: true };
    if (hm >= 7.5 && hm < 10.5) return { name: 'New York KZ', kz: true };
    if (hm >= 5 && hm < 7.5) return { name: 'London', kz: false };
    if (hm >= 10.5 && hm < 16) return { name: 'NY afternoon', kz: false };
    return { name: 'Asia', kz: false };
  }
  // Prop-firm "day" boundary (GFT daily drawdown resets ~16:05 CT). Returns a day key.
  function tradingDayKey(ms) {
    const d = new Date(ms - 16 * 3600000); // shift so 16:00 CT ≈ midnight-ish UTC-5 boundary
    const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const o = Object.fromEntries(p.map(x => [x.type, x.value]));
    return `${o.year}-${o.month}-${o.day}`;
  }
  const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric' });
  const fmtClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const fmtMonYr = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: '2-digit' });

  return { GRAN, fetchHistory, fetchLatest, fetchSpot, merge, normalize, deepDaily, deepIntraday, isOpen, filterOpen, nextOpen, session, tradingDayKey, ctParts,
    fmtTime: ms => fmtTime.format(new Date(ms)), fmtDay: ms => fmtDay.format(new Date(ms)), fmtClock: ms => fmtClock.format(new Date(ms)),
    fmtMonthYear: ms => fmtMonYr.format(new Date(ms)).replace(' ', " '") };
})();
