/* Market-structure engine (as-of safe: every object records WHEN it became known, so the backtester never peeks ahead).
   - pivots: fractal swing highs/lows with L bars left / R bars right; a pivot is "confirmed" at index i+R
   - zigzag: alternating H/L swings (same-type pivots keep the more extreme one), minimum swing size = atrMult × ATR
   - labels: HH / HL / LH / LL by comparing with the previous swing of the same type
   - events: close beyond last swing high/low → BOS (with trend) or CHoCH (against trend)
   - sweeps: wick beyond last swing high/low but close back inside
   - eq: equal highs/lows (liquidity pools) within a tolerance */
const Structure = (() => {
  function atr(c, n = 14) {
    const out = new Array(c.length).fill(0); const q = []; let sum = 0;
    for (let i = 0; i < c.length; i++) {
      const tr = i ? Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)) : (c[i].h - c[i].l);
      q.push(tr); sum += tr; if (q.length > n) sum -= q.shift();
      out[i] = sum / q.length;
    }
    return out;
  }

  function pivots(c, L, R) {
    const res = [];
    for (let i = L; i < c.length - R; i++) {
      let H = true, Lo = true;
      for (let k = 1; k <= L; k++) { if (c[i - k].h >= c[i].h) H = false; if (c[i - k].l <= c[i].l) Lo = false; if (!H && !Lo) break; }
      if (!H && !Lo) continue;
      for (let k = 1; k <= R; k++) { if (c[i + k].h > c[i].h) H = false; if (c[i + k].l < c[i].l) Lo = false; }
      if (H) res.push({ i, p: c[i].h, type: 'H', conf: i + R });
      if (Lo) res.push({ i, p: c[i].l, type: 'L', conf: i + R });
    }
    res.sort((a, b) => a.conf - b.conf || a.i - b.i);
    return res;
  }

  function analyze(c, opts) {
    const { L = 3, R = 3, atrMult = 0.6, eqTolPct = 0.0004 } = opts || {};
    const A = atr(c, 14);
    const piv = pivots(c, L, R);
    const zz = [], all = [], events = [], sweeps = [];
    const trendAt = new Array(c.length).fill(null);
    let trend = null, lastH = null, lastL = null, pi = 0;

    const prevSame = s => { for (let k = zz.length - 1; k >= 0; k--) if (zz[k] !== s && zz[k].type === s.type) return zz[k]; return null; };
    const label = s => { const p = prevSame(s); if (!p) return s.type; return s.type === 'H' ? (s.p > p.p ? 'HH' : 'LH') : (s.p > p.p ? 'HL' : 'LL'); };

    function insert(p, i) {
      const s = { i: p.i, p: p.p, type: p.type, conf: i, broken: false, brokenAt: null, swept: false, replacedAt: null, label: '' };
      const last = zz[zz.length - 1];
      if (last && last.type === s.type) {
        const better = s.type === 'H' ? s.p > last.p : s.p < last.p;
        if (!better) return;
        last.replacedAt = i; zz.pop();
      } else if (last) {
        if (Math.abs(s.p - last.p) < (A[i] || 0) * atrMult) return;
      }
      zz.push(s); all.push(s); s.label = label(s);
      if (s.type === 'H') lastH = s; else lastL = s;
    }

    for (let i = 0; i < c.length; i++) {
      while (pi < piv.length && piv[pi].conf <= i) { insert(piv[pi], i); pi++; }
      const b = c[i];
      if (lastH && !lastH.broken) {
        if (b.c > lastH.p) { events.push({ i, type: trend === 'down' ? 'CHoCH' : 'BOS', dir: 'up', level: lastH.p, swing: lastH }); trend = 'up'; lastH.broken = true; lastH.brokenAt = i; }
        else if (b.h > lastH.p) { sweeps.push({ i, dir: 'high', level: lastH.p, swing: lastH, first: !lastH.swept }); lastH.swept = true; }
      }
      if (lastL && !lastL.broken) {
        if (b.c < lastL.p) { events.push({ i, type: trend === 'up' ? 'CHoCH' : 'BOS', dir: 'down', level: lastL.p, swing: lastL }); trend = 'down'; lastL.broken = true; lastL.brokenAt = i; }
        else if (b.l < lastL.p) { sweeps.push({ i, dir: 'low', level: lastL.p, swing: lastL, first: !lastL.swept }); lastL.swept = true; }
      }
      trendAt[i] = trend;
    }
    const eq = equalLevels(zz, c, eqTolPct);
    return { c, atr: A, zz, all, events, sweeps, trend, trendAt, lastH, lastL, eq, opts: { L, R, atrMult } };
  }

  function equalLevels(zz, c, tolPct) {
    if (!c.length) return [];
    return clusterEq(zz.filter(s => !s.broken), c[c.length - 1].c * tolPct);
  }
  function clusterEq(pts0, tol) {
    const out = [];
    for (const type of ['H', 'L']) {
      const pts = pts0.filter(s => s.type === type).slice(-12);
      const used = new Set();
      for (let a = 0; a < pts.length; a++) {
        if (used.has(a)) continue;
        const grp = [pts[a]];
        for (let b = a + 1; b < pts.length; b++) if (!used.has(b) && Math.abs(pts[b].p - pts[a].p) <= tol) { grp.push(pts[b]); used.add(b); }
        if (grp.length >= 2) {
          used.add(a);
          const lv = type === 'H' ? Math.max(...grp.map(g => g.p)) : Math.min(...grp.map(g => g.p));
          out.push({ type, level: lv, from: grp[0].i, count: grp.length, swept: grp.some(g => g.swept) });
        }
      }
    }
    return out;
  }
  // Equal highs/lows using only swings that were known and unbroken at bar i.
  function equalLevelsAt(S, i, tolPct = 0.0004) {
    const pts = S.all.filter(s => s.conf <= i && (s.replacedAt === null || s.replacedAt > i) && (s.brokenAt === null || s.brokenAt > i));
    return clusterEq(pts, (S.c[i] ? S.c[i].c : 1) * tolPct);
  }

  // State as it was known at bar index i (for backtesting / replay).
  function stateAt(S, i) {
    if (i < 0) return { trend: null, lastH: null, lastL: null };
    let lastH = null, lastL = null;
    for (let k = S.all.length - 1; k >= 0 && !(lastH && lastL); k--) {
      const s = S.all[k];
      if (s.conf > i) continue;
      if (s.replacedAt !== null && s.replacedAt <= i) continue;
      if (s.type === 'H' && !lastH) lastH = s; else if (s.type === 'L' && !lastL) lastL = s;
    }
    const brokenAsOf = s => s && s.brokenAt !== null && s.brokenAt <= i;
    return { trend: S.trendAt[i], lastH, lastL, lastHBroken: brokenAsOf(lastH), lastLBroken: brokenAsOf(lastL) };
  }
  // Highest unbroken swing high above `price` known at i (next liquidity above); mirror for lows.
  function nextLiquidity(S, i, price, dir) {
    let best = null;
    for (let k = S.all.length - 1; k >= 0; k--) {
      const s = S.all[k];
      if (s.conf > i || (s.replacedAt !== null && s.replacedAt <= i)) continue;
      if (s.brokenAt !== null && s.brokenAt <= i) continue;
      if (dir === 'up' && s.type === 'H' && s.p > price && (!best || s.p < best.p)) best = s;
      if (dir === 'down' && s.type === 'L' && s.p < price && (!best || s.p > best.p)) best = s;
    }
    return best;
  }
  // Most recent swing of `type` located before bar `beforeIdx`, as known at bar i.
  function swingBefore(S, i, beforeIdx, type) {
    for (let k = S.all.length - 1; k >= 0; k--) {
      const s = S.all[k];
      if (s.conf > i || s.type !== type || s.i >= beforeIdx) continue;
      if (s.replacedAt !== null && s.replacedAt <= i) continue;
      return s;
    }
    return null;
  }
  function lastEvent(S, i, pred, minI = -1) {
    for (let k = S.events.length - 1; k >= 0; k--) { const e = S.events[k]; if (e.i > i) continue; if (e.i < minI) return null; if (!pred || pred(e)) return e; }
    return null;
  }
  function lastSweep(S, i, pred, minI = -1) {
    for (let k = S.sweeps.length - 1; k >= 0; k--) { const s = S.sweeps[k]; if (s.i > i) continue; if (s.i < minI) return null; if (!pred || pred(s)) return s; }
    return null;
  }
  // Human summary of the current structure of a timeframe.
  function describe(S) {
    const last = S.zz.slice(-4).map(s => s.label).join(' → ');
    const ev = S.events[S.events.length - 1];
    const sw = S.sweeps[S.sweeps.length - 1];
    return { trend: S.trend || 'range', last, ev, sw };
  }

  /* ---- Reading layer -------------------------------------------------------------------------
     phases(S): per-bar regime, as-of safe (uses only what was known at that bar).
       phase  TREND = trend confirmed by a BOS since the last CHoCH · SHIFT = a CHoCH happened, no BOS yet (unconfirmed change)
              RANGE = ≥2 CHoCH within `win` bars and no BOS since (chop) · NONE = no structure yet
       warn   'failed' = latest high is a LH in an uptrend (HL in a downtrend) — failed to extend
              'deep'   = latest low is a LL in an uptrend (HH in a downtrend) — wick went deeper without a close
              'sweep'  = the trend-defining swing (key) was wicked through, close held
       key    the swing whose close-break = CHoCH · far = the swing whose close-break = BOS (null when already broken → ext = price discovery) */
  const brokenAsOf = (s, i) => !!s && s.brokenAt !== null && s.brokenAt <= i;
  function phases(S, opts) {
    const { win = 48 } = opts || {};
    const n = S.c.length, out = new Array(n), sweptAt = new Map(), ch = [];
    let ai = 0, ei = 0, si = 0, lastH = null, lastL = null, lastEv = null, lastCh = -1, bosAfter = true, cur = null;
    for (let i = 0; i < n; i++) {
      while (ai < S.all.length && S.all[ai].conf <= i) { const s = S.all[ai++]; if (s.type === 'H') lastH = s; else lastL = s; }
      while (ei < S.events.length && S.events[ei].i <= i) { lastEv = S.events[ei++]; if (lastEv.type === 'CHoCH') { ch.push(lastEv.i); lastCh = lastEv.i; bosAfter = false; } else bosAfter = true; }
      while (si < S.sweeps.length && S.sweeps[si].i <= i) { const s = S.sweeps[si++]; sweptAt.set(s.swing, s.i); }
      while (ch.length && ch[0] < i - win) ch.shift();
      const trend = S.trendAt[i];
      const phase = !trend ? 'NONE' : (ch.length >= 2 && !bosAfter) ? 'RANGE' : !bosAfter ? 'SHIFT' : 'TREND';
      const warn = []; let ext = false, key = null, far = null;
      if (trend) {
        key = trend === 'up' ? lastL : lastH; far = trend === 'up' ? lastH : lastL;
        if (far && brokenAsOf(far, i)) { ext = true; far = null; }
        if (key && brokenAsOf(key, i)) key = null;
        // only swings formed / sweeps taken inside the current trend count as warnings (not leftovers from the previous trend)
        if (far && far.conf > lastCh && far.label === (trend === 'up' ? 'LH' : 'HL')) warn.push('failed');
        if (key && key.conf > lastCh && key.label === (trend === 'up' ? 'LL' : 'HH')) warn.push('deep');
        if (key && (sweptAt.get(key) || -1) > lastCh) warn.push('sweep');
      }
      const same = cur && cur.phase === phase && cur.trend === trend && cur.ext === ext && cur.warn.join() === warn.join();
      if (!same || cur.key !== key || cur.far !== far) cur = { phase, trend, warn, ext, key, far, since: same ? cur.since : i, ev: lastEv };
      out[i] = cur;
    }
    return out;
  }
  // Chart-specific odds: what followed each warning / CHoCH historically. Also marks CHoCH events with outcome 'confirmed' | 'fake'.
  function phaseStats(S, ph) {
    const ev = S.events, med = a => { a = a.slice().sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; };
    const st = { failed: { n: 0, flip: 0, bars: [] }, deep: { n: 0, flip: 0, bars: [] }, sweep: { n: 0, flip: 0, bars: [] }, shift: { n: 0, conf: 0, bars: [] } };
    let ei = 0;
    for (let i = 1; i < ph.length; i++) {
      const a = ph[i - 1], b = ph[i]; if (a === b) continue;
      while (ei < ev.length && ev[ei].i <= i) ei++;
      const e = ev[ei]; if (!e) break;
      if (b.phase === 'TREND') for (const w of b.warn) if (!(a.phase === 'TREND' && a.trend === b.trend && a.warn.includes(w))) { st[w].n++; if (e.type === 'CHoCH') st[w].flip++; st[w].bars.push(e.i - i); }
      if (b.phase === 'SHIFT' && a.phase !== 'SHIFT') { st.shift.n++; if (e.type === 'BOS') st.shift.conf++; st.shift.bars.push(e.i - i); }
    }
    for (const k of Object.keys(st)) { st[k].med = med(st[k].bars); delete st[k].bars; }
    const ch = [];
    for (let k = 0; k < ev.length; k++) if (ev[k].type === 'CHoCH') { ev[k].outcome = k + 1 < ev.length ? (ev[k + 1].type === 'BOS' ? 'confirmed' : 'fake') : null; ch.push(ev[k].i); }
    st.trendLen = med(ch.slice(1).map((v, k) => v - ch[k]));
    st.rangePct = ph.length ? ph.filter(p => p.phase === 'RANGE').length / ph.length : 0;
    return st;
  }
  // Swing candidates in the last R bars that are not confirmed yet (a later bar may still exceed them).
  function forming(S) {
    const c = S.c, n = c.length, { L, R, atrMult } = S.opts, zz = S.zz, last = zz[zz.length - 1], out = [];
    if (!last) return out;
    for (const type of ['H', 'L']) {
      let best = null;
      for (let i = Math.max(L, n - R); i < n; i++) {
        let ok = true;
        for (let k = 1; k <= L && ok; k++) ok = type === 'H' ? c[i - k].h < c[i].h : c[i - k].l > c[i].l;
        for (let k = 1; i + k < n && ok; k++) ok = type === 'H' ? c[i + k].h <= c[i].h : c[i + k].l >= c[i].l;
        const p = type === 'H' ? c[i].h : c[i].l;
        if (ok && (!best || (type === 'H' ? p > best.p : p < best.p))) best = { i, p, type, confirmIn: i + R - (n - 1) };
      }
      if (!best) continue;
      let prev, from;
      if (last.type === type) { if (!(type === 'H' ? best.p > last.p : best.p < last.p)) continue; from = zz[zz.length - 2]; prev = zz.slice(0, -1).reverse().find(s => s.type === type); }
      else { if (Math.abs(best.p - last.p) < (S.atr[n - 1] || 0) * atrMult) continue; from = last; prev = zz[zz.length - 2]; }
      best.label = prev ? (type === 'H' ? (best.p > prev.p ? 'HH' : 'LH') : (best.p > prev.p ? 'HL' : 'LL')) : type;
      best.from = from || null; best.replaces = last.type === type ? last : null;
      out.push(best);
    }
    return out;
  }
  // Live-bar heads-up: the unclosed bar is already trading through the phase's key (→ CHoCH) or far (→ BOS) level.
  // It only becomes an event if the bar CLOSES there, so this is a warning, not a signal.
  function pending(p, live, lastClosed, gran, now) {
    if (!p || !p.trend || !live || (lastClosed && live.t <= lastClosed.t)) return null;
    const minsLeft = Math.max(0, Math.ceil((live.t + gran - now) / 60000));
    const against = p.trend === 'up' ? 'down' : 'up';
    if (p.key && (against === 'down' ? live.c < p.key.p : live.c > p.key.p)) return { type: 'CHoCH', dir: against, level: p.key.p, swing: p.key, barT: live.t, minsLeft };
    if (p.far && (p.trend === 'up' ? live.c > p.far.p : live.c < p.far.p)) return { type: 'BOS', dir: p.trend, level: p.far.p, swing: p.far, barT: live.t, minsLeft };
    return null;
  }
  const WARN = { up: { failed: 'LH formed', deep: 'LL by wick', sweep: 'HL swept' }, down: { failed: 'HL formed', deep: 'HH by wick', sweep: 'LH swept' } };
  // Short words for chips / hover / ribbon legend.
  function phaseLabel(p) {
    if (!p || p.phase === 'NONE') return { short: 'no structure yet', cls: 'range', warnTxt: '' };
    const warnTxt = p.warn.map(w => WARN[p.trend][w]).join(' + ');
    if (p.phase === 'RANGE') return { short: 'CHOP · no follow-through', cls: 'range', warnTxt };
    if (p.phase === 'SHIFT') return { short: `SHIFTING ${p.trend === 'up' ? '▲' : '▼'} · CHoCH, needs BOS${warnTxt ? ' · ⚠ ' + warnTxt : ''}`, cls: 'shift', warnTxt };
    if (p.warn.length) return { short: `⚠ WARNING · ${warnTxt}`, cls: 'warn', warnTxt };
    return { short: p.ext ? 'HEALTHY · in discovery' : 'HEALTHY', cls: p.trend, warnTxt };
  }
  return { atr, pivots, analyze, stateAt, nextLiquidity, swingBefore, lastEvent, lastSweep, describe, equalLevelsAt, phases, phaseStats, forming, pending, phaseLabel, WARN };
})();
