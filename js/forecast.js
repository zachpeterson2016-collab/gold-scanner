/* Forecast: "what should happen next" from previous knowledge — then graded live so you can see how close it was.
   PATH      the K most similar past windows (same shape, same 1H trend) → their next H bars, ATR-scaled → median path + 50% / 80% bands
   SCENARIO  the setup engine's current phase → pullback zone → target, bust level, plus how often that exact phase resolved each way in history
   LOG       predictions are frozen in localStorage and scored bar by bar against reality AND against a flat line ("price stays here") */
const Forecast = (() => {
  // look = how many bars back the pattern search scans (keeps the back-fill cheap once a year of 15m history is loaded)
  const CFG = { '15m': { W: 24, H: 16, scen: 64, look: 6000 }, '1h': { W: 24, H: 12, scen: 48, look: 5000 }, '1d': { W: 16, H: 5, scen: 20, look: Infinity } };
  const K = 20, LS = 'gs_preds_v1', MAXLOG = 300, PHASES = ['TREND', 'WATCHING', 'WAITING', 'TRIGGERED', 'ACTIVE'];
  const quant = (a, q) => { const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return a[lo] + (a[hi] - a[lo]) * (pos - lo); };
  const r2 = v => Math.round(v * 100) / 100;
  function idxAt(c, t) { let lo = 0, hi = c.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }

  // ---- pattern path ---------------------------------------------------------------------------
  const shapeCache = new Map();
  // Shape vectors are only built for the bars the search can reach (last look + back-fill span), so a year of 15m candles stays cheap.
  function shapes(c, W, A, look) {
    const from = isFinite(look) ? Math.max(W - 1, c.length - look - 1500) : W - 1;
    const key = `${W}|${from}|${c.length}|${c.length ? c[0].t + '|' + c[c.length - 1].t : ''}`;
    if (shapeCache.has(key)) return shapeCache.get(key);
    const out = new Array(c.length).fill(null);
    for (let i = from; i < c.length; i++) { if (!A[i]) continue; const v = new Float64Array(W), b = c[i].c, a = A[i]; for (let k = 0; k < W; k++) v[k] = (c[i - W + 1 + k].c - b) / a; out[i] = v; }
    if (shapeCache.size > 6) shapeCache.delete(shapeCache.keys().next().value);
    shapeCache.set(key, out); return out;
  }
  function dist(u, v) { let d = 0; const W = u.length; for (let k = 0; k < W; k++) { const w = 0.5 + 0.5 * (k + 1) / W, e = u[k] - v[k]; d += w * e * e; } return Math.sqrt(d / W); }

  // Forecast at bar i using only bars ≤ i (no peeking), so the same code can be back-filled honestly.
  function path(c, S, i, cfg, opts) {
    const { W, H } = cfg, A = S.atr, so = opts && opts.stateOf, look = cfg.look || Infinity;
    if (i < W + 40 || !A[i]) return null;
    const sh = shapes(c, W, A, look), q = sh[i]; if (!q) return null;
    const state = so ? so(i) : null;
    const nearest = useState => {
      const out = [];
      for (let j = Math.max(W + 14, i - look); j <= i - H - 1; j++) { if (!sh[j]) continue; if (useState && so(j) !== state) continue; out.push({ j, d: dist(q, sh[j]) }); }
      out.sort((a, b) => a.d - b.d);
      const pick = [];
      for (const x of out) { if (pick.every(p => Math.abs(p.j - x.j) > W / 2)) pick.push(x); if (pick.length >= K) break; }
      return pick;
    };
    let matched = !!state, pick = nearest(matched);
    if (pick.length < 8 && matched) { matched = false; pick = nearest(false); }
    if (pick.length < 5) return null;
    const base = c[i].c, a0 = A[i], med = [], q10 = [], q25 = [], q75 = [], q90 = [];
    for (let h = 1; h <= H; h++) {
      const v = pick.map(p => base + (c[p.j + h].c - c[p.j].c) / A[p.j] * a0).sort((x, y) => x - y);
      q10.push(quant(v, .1)); q25.push(quant(v, .25)); med.push(quant(v, .5)); q75.push(quant(v, .75)); q90.push(quant(v, .9));
    }
    const ups = pick.filter(p => c[p.j + H].c > c[p.j].c).length;
    return { i, t: c[i].t, c0: base, atr: a0, H, med, q10, q25, q75, q90, pUp: ups / pick.length, k: pick.length, matched, state, analogs: pick.map(p => ({ i: p.j, t: c[p.j].t, d: p.d })) };
  }

  // ---- structure scenario ----------------------------------------------------------------------
  function scenarioAt(ctx, i) {
    for (const side of ['long', 'short']) {
      const r = Setups.detect(ctx, i, side);
      if (!r.levels || !PHASES.includes(r.status)) continue;
      const long = side === 'long', L = r.levels, trade = L.entry !== undefined;
      const zA = long ? L.ext - L.leg * 0.382 : L.ext + L.leg * 0.382, zB = long ? Math.max(L.anchor, L.ext - L.leg * 0.79) : Math.min(L.anchor, L.ext + L.leg * 0.79);
      let target = trade ? L.tp : L.ext;
      // In the TREND phase price sits at the extreme, so "reach ext" is trivial — project to the next 1H liquidity pool (or +50% of the leg) instead.
      if (r.status === 'TREND') { const liq = Structure.nextLiquidity(ctx.S1h, ctx.h1Idx[i], L.ext, long ? 'up' : 'down'); target = liq ? liq.p : (long ? L.ext + L.leg * 0.5 : L.ext - L.leg * 0.5); }
      return { side, phase: r.status, grade: r.grade, zone: [Math.min(zA, zB), Math.max(zA, zB)], target, bust: trade ? L.stop : L.anchor, bustKind: trade ? 'wick' : 'close', needZone: r.status === 'TREND', c0: ctx.c15[i].c };
    }
    return null;
  }
  // Walk forward from i0: did the scenario reach its target, get busted, or neither (bust checked first = conservative)?
  function resolve(c, i0, sc, maxBars) {
    const long = sc.side === 'long'; let zoneAt = sc.needZone ? null : i0, targetAt = null, bustAt = null, mfe = 0, mae = 0;
    const end = Math.min(c.length - 1, i0 + maxBars);
    for (let k = i0 + 1; k <= end; k++) {
      const b = c[k];
      if (zoneAt === null && b.l <= sc.zone[1] && b.h >= sc.zone[0]) zoneAt = k;
      mfe = Math.max(mfe, long ? b.h - sc.c0 : sc.c0 - b.l); mae = Math.max(mae, long ? sc.c0 - b.l : b.h - sc.c0);
      const busted = sc.bustKind === 'wick' ? (long ? b.l <= sc.bust : b.h >= sc.bust) : (long ? b.c < sc.bust : b.c > sc.bust);
      if (busted) { bustAt = k; break; }
      if (long ? b.h >= sc.target : b.l <= sc.target) { targetAt = k; break; }
    }
    const at = bustAt !== null ? bustAt : targetAt !== null ? targetAt : end, bars = at - i0, done = bustAt !== null || targetAt !== null || bars >= maxBars;
    return { outcome: bustAt !== null ? 'bust' : targetAt !== null ? 'target' : bars >= maxBars ? 'neither' : 'open', bars, zoneAt, targetAt, bustAt, mfe: r2(mfe), mae: r2(mae), done };
  }
  // One pass over history, extended incrementally. Samples at phase changes and every 16 bars inside a phase (neighbouring bars are not independent evidence).
  let oc = { pk: '', n: 0, rows: [], prev: '', since: 0 };
  function classify(ctx, maxBars) {
    const c = ctx.c15, pk = JSON.stringify(ctx.params) + '|' + (c.length ? c[0].t : 0);
    if (oc.pk !== pk || oc.n > c.length) oc = { pk, n: 200, rows: [], prev: '', since: 0 };
    for (let i = oc.n; i < c.length - 1; i++) {
      const sc = scenarioAt(ctx, i), sig = sc ? sc.side + sc.phase : '';
      oc.since++;
      if (sig && (sig !== oc.prev || oc.since >= 16)) { oc.rows.push({ i, t: c[i].t, sc, res: null }); oc.since = 0; }
      oc.prev = sig;
    }
    oc.n = Math.max(oc.n, c.length - 1);
    for (const r of oc.rows) if (!r.res || !r.res.done) r.res = resolve(c, r.i, r.sc, maxBars);
    return oc.rows;
  }
  function odds(rows, sc) {
    let m = rows.filter(r => r.res.done && r.sc.side === sc.side && r.sc.phase === sc.phase), pooled = false;
    if (m.length < 8) { m = rows.filter(r => r.res.done && r.sc.side === sc.side); pooled = true; }
    const n = m.length, cnt = o => m.filter(r => r.res.outcome === o).length;
    const tb = m.filter(r => r.res.outcome === 'target').map(r => r.res.bars).sort((a, b) => a - b);
    const viaZone = m.filter(r => r.res.outcome === 'target' && r.res.zoneAt !== null && r.res.zoneAt < r.res.targetAt).length;
    return { n, pooled, target: n ? cnt('target') / n : 0, bust: n ? cnt('bust') / n : 0, neither: n ? cnt('neither') / n : 0, viaZone: tb.length ? viaZone / tb.length : 0, medBars: tb.length ? tb[tb.length >> 1] : null };
  }

  // ---- prediction log --------------------------------------------------------------------------
  function load() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } }
  function save(list) { try { const keep = []; for (const tf of Object.keys(CFG)) keep.push(...list.filter(p => p.tf === tf).slice(-MAXLOG)); localStorage.setItem(LS, JSON.stringify(keep.sort((a, b) => a.t - b.t))); } catch (e) { } }
  function make(tf, p, sc, od, src) {
    return {
      id: `${tf}-${p.t}${src === 'backfill' ? '-b' : ''}`, src, tf, t: p.t, c0: p.c0, atr: r2(p.atr), H: p.H, k: p.k, pUp: r2(p.pUp), matched: p.matched,
      med: p.med.map(r2), q10: p.q10.map(r2), q25: p.q25.map(r2), q75: p.q75.map(r2), q90: p.q90.map(r2),
      sc: sc ? { side: sc.side, phase: sc.phase, grade: sc.grade, zone: sc.zone.map(r2), target: r2(sc.target), bust: r2(sc.bust), bustKind: sc.bustKind, needZone: sc.needZone, c0: sc.c0, maxBars: CFG[tf].scen, odds: od || null } : null,
      status: 'pending', n: 0, scen: null
    };
  }
  function autoLog(list, tf, p, sc, every, c) {
    if (!p || !(every > 0)) return list;
    const live = list.filter(x => x.tf === tf && x.src === 'live');
    const last = live.reduce((a, b) => (!a || b.t > a.t ? b : a), null);
    if (last && last.t >= p.t) return list;
    if (last) {
      const bars = p.i - idxAt(c, last.t);
      const phaseChanged = sc && last.sc ? (sc.side !== last.sc.side || sc.phase !== last.sc.phase) : (!!sc !== !!last.sc);
      if (bars < every && !phaseChanged) return list;
    }
    list.push(make(tf, p, sc, sc && sc.odds, 'live')); return list.sort((a, b) => a.t - b.t);
  }
  function pin(list, tf, p, sc) {
    if (!p) return { list, added: false };
    if (list.some(x => x.tf === tf && x.src === 'live' && x.t === p.t)) return { list, added: false };
    list.push(make(tf, p, sc, sc && sc.odds, 'live')); return { list: list.sort((a, b) => a.t - b.t), added: true };
  }
  function grade(p, c) {
    const i0 = idxAt(c, p.t); if (i0 < 0 || c[i0].t !== p.t) return false;
    const avail = Math.min(p.H, c.length - 1 - i0); if (avail <= 0) return false;
    let sae = 0, saeF = 0, in50 = 0, in80 = 0;
    for (let h = 1; h <= avail; h++) {
      const a = c[i0 + h].c; sae += Math.abs(a - p.med[h - 1]); saeF += Math.abs(a - p.c0);
      if (a >= p.q25[h - 1] && a <= p.q75[h - 1]) in50++; if (a >= p.q10[h - 1] && a <= p.q90[h - 1]) in80++;
    }
    const last = c[i0 + avail].c, pm = p.med[avail - 1] - p.c0, am = last - p.c0, k = avail - 1;
    Object.assign(p, {
      n: avail, mae: r2(sae / avail), maeFlat: r2(saeF / avail), in50: r2(in50 / avail), in80: r2(in80 / avail), last, err: r2(last - p.med[k]),
      dir: Math.abs(pm) < 0.15 * p.atr ? 'flat' : Math.sign(pm) === Math.sign(am) ? 'hit' : 'miss',
      inBand: last >= p.q25[k] && last <= p.q75[k] ? 50 : last >= p.q10[k] && last <= p.q90[k] ? 80 : 0
    });
    if (p.sc && !(p.scen && p.scen.done)) p.scen = resolve(c, i0, p.sc, p.sc.maxBars);
    p.status = avail >= p.H ? 'done' : 'pending';
    return true;
  }
  // Returns the predictions that just finished (for a toast).
  function score(list, cands) {
    const finished = [];
    for (const p of list) {
      if (p.status === 'done' && (!p.sc || (p.scen && p.scen.done))) continue;
      const was = p.status; if (!cands[p.tf]) continue;
      grade(p, cands[p.tf]);
      if (was !== 'done' && p.status === 'done') finished.push(p);
    }
    return finished;
  }
  function stats(list) {
    const done = list.filter(p => p.status === 'done'), n = done.length;
    const hits = done.filter(p => p.dir === 'hit').length, miss = done.filter(p => p.dir === 'miss').length, beat = done.filter(p => p.mae < p.maeFlat).length;
    const avg = f => n ? done.reduce((s, p) => s + f(p), 0) / n : 0;
    const sd = list.filter(p => p.scen && p.scen.done), sn = sd.length, so = o => sd.filter(p => p.scen.outcome === o).length;
    return { n, dirAcc: hits + miss ? hits / (hits + miss) : null, flat: n - hits - miss, beatFlat: n ? beat / n : null, mae: avg(p => p.mae), maeFlat: avg(p => p.maeFlat), maeATR: avg(p => p.mae / p.atr), cov50: n ? avg(p => p.in50) : null, cov80: n ? avg(p => p.in80) : null, sn, target: sn ? so('target') / sn : 0, bust: sn ? so('bust') / sn : 0, neither: sn ? so('neither') / sn : 0 };
  }
  // The same forecaster run at past bars as if live, so there is a track record from day one. A past bar's forecast and
  // grade never change (only bars ≤ i are used), so they are cached and each new candle costs one path() call.
  const bfCache = new Map();
  function backfill(tf, c, S, cfg, opts, step, points, ctx) {
    const out = [], n = c.length, base = `${tf}|${cfg.W}|${cfg.H}|${!!(opts && opts.stateOf)}|${n ? c[0].t : 0}|`;
    for (let i = n - 1 - cfg.H - (points - 1) * step; i <= n - 1 - cfg.H; i += step) {
      if (i < cfg.W + 40) continue;
      const key = base + c[i].t;
      let pr = bfCache.get(key);
      if (pr === undefined) {
        const p = path(c, S, i, cfg, opts);
        pr = p ? make(tf, p, ctx ? scenarioAt(ctx, i) : null, null, 'backfill') : null; if (pr) grade(pr, c);
        if (bfCache.size > 2000) for (const k of [...bfCache.keys()].slice(0, 500)) bfCache.delete(k);
        bfCache.set(key, pr);
      }
      if (pr) out.push(pr);
    }
    return out;
  }
  return { CFG, idxAt, path, scenarioAt, resolve, classify, odds, load, save, autoLog, pin, score, stats, backfill };
})();
