/* Setup detection (the "diagram 4" trend-pullback), grading, position sizing, backtest and live journal. */
const Setups = (() => {
  const RANK = { A: 3, B: 2, C: 1, D: 0, X: -1 };
  const DEFAULTS = { minLegATR: 1.0, minRetr: 0.382, triggerBars: 16, minBuffer: 1.5, minR: 1.5, gradeA: 4.5, gradeB: 3, gradeC: 2, maxBars: 96, tpMode: 'tp1', sessions: 'ldn_ny', daily: 'require' };

  // Map every 15m bar to the last COMPLETED 1H and Daily bar at that moment.
  function buildContext(c15, S15, S1h, SD, params) {
    const h1Idx = new Array(c15.length), dIdx = new Array(c15.length);
    let j = -1, d = -1;
    const c1 = S1h.c, cd = SD ? SD.c : [];
    for (let i = 0; i < c15.length; i++) {
      const close = c15[i].t + 900000;
      while (j + 1 < c1.length && c1[j + 1].t + 3600000 <= close) j++;
      while (d + 1 < cd.length && cd[d + 1].t + 86400000 <= close) d++;
      h1Idx[i] = j; dIdx[i] = d;
    }
    return { c15, S15, S1h, SD, h1Idx, dIdx, params: Object.assign({}, DEFAULTS, params || {}) };
  }

  function detect(ctx, i, side) {
    const long = side === 'long', want = long ? 'up' : 'down';
    const c = ctx.c15, bar = c[i], price = bar.c, P = ctx.params;
    const res = { side, status: 'NONE', grade: 'X', score: 0, checks: [], i, t: bar.t, price, levels: null };
    const j = ctx.h1Idx[i], d = ctx.dIdx[i];
    if (j < 0) { res.reason = 'not enough 1H history'; return res; }
    const st1 = Structure.stateAt(ctx.S1h, j);
    const stD = ctx.SD && d >= 0 ? Structure.stateAt(ctx.SD, d) : { trend: null };
    res.htf = { h1: st1.trend, d: stD.trend };
    const htfOk = st1.trend === want;
    res.checks.push({ ok: htfOk, label: `1H trend ${long ? 'UP (HH + HL)' : 'DOWN (LH + LL)'}`, detail: st1.trend ? `1H is ${st1.trend}` : '1H unclear' });
    if (!htfOk) { res.reason = `1H trend is ${st1.trend || 'unclear'} — no ${side}s`; return res; }
    const dAligned = stD.trend === want;
    const dHard = P.daily === 'require';
    res.checks.push({ ok: dAligned, soft: !dHard, label: dHard ? 'Daily trend aligned (required)' : 'Daily trend aligned (bonus)', detail: stD.trend ? `D is ${stD.trend}` : 'D unclear' });
    if (dAligned) res.score += 1;
    res.dAligned = dAligned;
    if (dHard && !dAligned) { res.reason = `Daily is ${stD.trend || 'unclear'} — ${side}s are against the daily trend. Skip.`; return res; }

    // Impulse origin = the 1H swing low just BEFORE the last 1H swing high (long); mirrored for shorts.
    const lastSwing = long ? st1.lastH : st1.lastL;
    const anchor = lastSwing ? Structure.swingBefore(ctx.S1h, j, lastSwing.i, long ? 'L' : 'H') : null;
    if (!anchor) { res.reason = 'no 1H swing yet'; return res; }
    const t0 = ctx.S1h.c[anchor.i].t;
    let ext = long ? -Infinity : Infinity, extIdx = -1;
    for (let k = i; k >= 0 && c[k].t >= t0; k--) { const v = long ? c[k].h : c[k].l; if (long ? v > ext : v < ext) { ext = v; extIdx = k; } }
    if (extIdx < 0) { res.reason = '1H swing newer than 15m data'; return res; }
    const leg = Math.abs(ext - anchor.p), atr1 = ctx.S1h.atr[j] || 1;
    const legOk = leg >= atr1 * P.minLegATR;
    res.checks.push({ ok: legOk, label: `Impulse leg ≥ ${P.minLegATR}× ATR(1H)`, detail: `$${leg.toFixed(1)} vs $${(atr1 * P.minLegATR).toFixed(1)}` });
    if (!legOk) { res.reason = 'impulse leg too small'; return res; }
    // Depth of the pullback = the extreme wick since the impulse top/bottom; "intact" = no 15m CLOSE through the 1H swing (wicks through = sweep, fine).
    let pullExt = long ? Infinity : -Infinity, pullIdx = extIdx, worstClose = long ? Infinity : -Infinity;
    for (let k = extIdx; k <= i; k++) { const v = long ? c[k].l : c[k].h; if (long ? v < pullExt : v > pullExt) { pullExt = v; pullIdx = k; } worstClose = long ? Math.min(worstClose, c[k].c) : Math.max(worstClose, c[k].c); }
    const retr = long ? (ext - pullExt) / leg : (pullExt - ext) / leg;
    const intact = long ? worstClose > anchor.p : worstClose < anchor.p;
    const inZone = retr >= P.minRetr && intact;
    res.levels = { anchor: anchor.p, anchorT: t0, ext, extIdx, leg, retr, pullExt, pullIdx };
    res.checks.push({ ok: inZone, label: `Pulled back ≥ ${Math.round(P.minRetr * 100)}% of the leg (structure intact)`, detail: `${(retr * 100).toFixed(0)}% retrace` });
    if (retr >= 0.5 && retr <= 0.79) res.score += 1; else if (inZone) res.score += 0.5;
    if (!inZone) { res.status = 'TREND'; res.reason = !intact ? 'pullback closed through the 1H swing — structure in doubt' : `1H trend ${want} — waiting for a pullback (${Math.max(0, retr * 100).toFixed(0)}% so far, need ${Math.round(P.minRetr * 100)}%)`; return res; }

    const K = P.triggerBars;
    const evAny = Structure.lastEvent(ctx.S15, i, null, Math.max(i - K, extIdx + 1));
    const ev = evAny && evAny.dir === want ? evAny : null; // a newer break AGAINST us cancels the trigger
    const sw = Structure.lastSweep(ctx.S15, ev ? ev.i : i, s => s.dir === (long ? 'low' : 'high'), Math.max(i - 2 * K, extIdx));
    res.checks.push({ ok: !!sw, label: `15m sweep of ${long ? 'lows' : 'highs'} (liquidity grab)`, detail: sw ? `${i - sw.i} bars ago` : 'none yet' });
    res.checks.push({ ok: !!ev, label: `15m ${ev ? ev.type : 'CHoCH'} ${long ? '↑' : '↓'} = trigger`, detail: ev ? `${i - ev.i} bars ago` : 'waiting' });
    if (!ev) { res.status = sw ? 'WAITING' : 'WATCHING'; res.reason = sw ? `sweep done — now wait for a 15m close ${long ? 'above the last 15m lower high' : 'below the last 15m higher low'}` : 'price is in the zone — wait for a sweep, then a 15m CHoCH'; return res; }
    if (sw) res.score += 1.5;

    const from = Math.max(extIdx, sw ? sw.i : ev.i - 8);
    let stopBase = long ? Infinity : -Infinity;
    for (let k = from; k <= ev.i; k++) stopBase = long ? Math.min(stopBase, c[k].l) : Math.max(stopBase, c[k].h);
    const buffer = Math.max(P.minBuffer, (ctx.S15.atr[i] || 0) * 0.2);
    const stop = long ? stopBase - buffer : stopBase + buffer;
    const entry = c[ev.i].c;
    const tp1 = ext;
    const liq = Structure.nextLiquidity(ctx.S1h, j, ext, want);
    const eqs = Structure.equalLevelsAt(ctx.S1h, j).filter(e => e.type === (long ? 'H' : 'L') && (long ? e.level > ext : e.level < ext)).map(e => e.level);
    let tp2 = liq ? liq.p : null;
    if (eqs.length) { const e = long ? Math.min(...eqs) : Math.max(...eqs); tp2 = tp2 === null ? e : (long ? Math.min(tp2, e) : Math.max(tp2, e)); }
    if (tp2 === null) tp2 = long ? ext + leg * 0.5 : ext - leg * 0.5;
    const risk = Math.abs(entry - stop);
    const R1 = Math.abs(tp1 - entry) / risk, R2 = Math.abs(tp2 - entry) / risk;
    // Default: target the impulse extreme (what the diagrams teach). Only reach for the next liquidity pool when TP1 pays too little.
    let tp = tp1, R = R1;
    if (P.tpMode === 'auto' ? (R1 < 3 && R2 > R1 && R2 <= 6) : (R1 < P.minR && R2 >= P.minR)) { tp = tp2; R = R2; }
    res.checks.push({ ok: R >= P.minR, label: `Reward ≥ ${P.minR}R to the target`, detail: `${R.toFixed(1)}R` });
    if (R >= 3) res.score += 1; else if (R >= 2) res.score += 0.5;
    const sess = Data.session(c[ev.i].t);
    const sessOk = P.sessions === 'all' || !(sess.name === 'Asia' || sess.name === 'Closed');
    res.checks.push({ ok: sess.kz, soft: sessOk, label: sessOk ? 'Trigger inside London / NY kill zone' : 'Trigger during London / New York hours', detail: sess.name });
    if (sess.kz) res.score += 1;
    Object.assign(res.levels, { entry, stop, tp, tp1, tp2, R, R1, R2, risk, stopBase, buffer, evI: ev.i, swI: sw ? sw.i : null, session: sess.name, evType: ev.type });
    res.ageBars = i - ev.i;
    let hitStop = false, hitTp = false;
    for (let k = ev.i + 1; k <= i && !hitStop && !hitTp; k++) { hitStop = long ? c[k].l <= stop : c[k].h >= stop; hitTp = long ? c[k].h >= tp : c[k].l <= tp; }
    const ranAway = long ? price > entry + risk * 0.75 : price < entry - risk * 0.75;
    res.status = res.ageBars === 0 ? 'TRIGGERED' : hitStop ? 'STOPPED' : hitTp ? 'DONE' : ranAway ? 'MISSED' : 'ACTIVE';
    if (!sessOk) { res.grade = 'X'; res.reason = `${sess.name} session trigger — thin market, outside London/New York hours. Skip.`; }
    else if (R < P.minR) { res.grade = 'X'; res.reason = `only ${R.toFixed(1)}R to the target — skip`; }
    else res.grade = res.score >= P.gradeA ? 'A' : res.score >= P.gradeB ? 'B' : res.score >= P.gradeC ? 'C' : 'D';
    return res;
  }

  function size(levels, s) {
    const riskUSD = s.account * s.riskPct / 100;
    const perLot = levels.risk * 100; // $ per lot for the stop distance (1 lot = 100 oz)
    let lots = Math.floor(riskUSD / perLot * 100) / 100;
    if (lots < 0.01) lots = 0.01;
    const margin = lots * 100 * levels.entry / (s.leverage || 20);
    return { riskUSD, lots, margin, marginPct: margin / s.account * 100, ticks: Math.round(levels.risk * 100), tpTicks: Math.round(Math.abs(levels.tp - levels.entry) * 100), rewardUSD: lots * 100 * Math.abs(levels.tp - levels.entry), lossUSD: lots * perLot };
  }

  function backtest(ctx, s, opts) {
    opts = Object.assign({ minGrade: 'B', maxBars: ctx.params.maxBars }, opts || {});
    const c = ctx.c15, trades = [];
    let open = null;
    const warm = Math.min(200, Math.max(0, c.length - 1));
    const finish = (tr, i, pnlR, result) => { tr.exitI = i; tr.exitT = c[i].t; tr.pnlR = pnlR; tr.result = result; trades.push(tr); open = null; };
    for (let i = warm; i < c.length; i++) {
      const b = c[i];
      if (open) {
        const long = open.side === 'long';
        const slHit = long ? b.l <= open.stop : b.h >= open.stop;
        const tpHit = long ? b.h >= open.tp : b.l <= open.tp;
        if (slHit) finish(open, i, -1, 'loss');
        else if (tpHit) finish(open, i, open.R, 'win');
        else if (i - open.i >= opts.maxBars) finish(open, i, (long ? b.c - open.entry : open.entry - b.c) / open.risk, 'time');
      }
      if (open) continue;
      for (const side of ['long', 'short']) {
        const r = detect(ctx, i, side);
        if (r.status === 'TRIGGERED' && RANK[r.grade] >= RANK[opts.minGrade]) {
          open = { i, t: b.t, side, grade: r.grade, score: r.score, entry: r.levels.entry, stop: r.levels.stop, tp: r.levels.tp, R: r.levels.R, risk: r.levels.risk, session: r.levels.session, sweep: r.levels.swI !== null, dAligned: r.dAligned };
          break;
        }
      }
    }
    if (open) { open.result = 'open'; open.pnlR = 0; trades.push(open); }
    return { trades, stats: stats(trades, s) };
  }

  function stats(trades, s) {
    const closed = trades.filter(t => t.result !== 'open');
    const riskUSD = s.account * s.riskPct / 100;
    const out = { n: closed.length, wins: 0, losses: 0, sumR: 0, grossWin: 0, grossLoss: 0, maxConsecLoss: 0, bySession: {}, byGrade: {}, bySide: {}, byDaily: {}, bySweep: {}, equity: [], maxDD: 0, maxDDPct: 0, worstDay: 0, worstDayKey: null, breached: null, passedAt: null };
    let eq = s.account, peak = eq, streak = 0; const days = {};
    out.equity.push({ t: closed.length ? closed[0].t : Date.now(), eq });
    for (const t of closed) {
      const r = t.pnlR, pnl = r * riskUSD;
      out.sumR += r; if (r > 0) { out.wins++; out.grossWin += r; streak = 0; } else { out.losses++; out.grossLoss += -r; streak++; out.maxConsecLoss = Math.max(out.maxConsecLoss, streak); }
      const bucket = (m, k) => { const o = m[k] || (m[k] = { n: 0, wins: 0, sumR: 0 }); o.n++; if (r > 0) o.wins++; o.sumR += r; };
      bucket(out.bySession, t.session); bucket(out.byGrade, t.grade); bucket(out.bySide, t.side);
      bucket(out.byDaily, t.dAligned ? 'Daily agrees' : 'Against daily'); bucket(out.bySweep, t.sweep ? 'With sweep' : 'No sweep');
      eq += pnl; out.equity.push({ t: t.exitT, eq });
      peak = Math.max(peak, eq); const dd = peak - eq; if (dd > out.maxDD) { out.maxDD = dd; out.maxDDPct = dd / peak * 100; }
      const dk = Data.tradingDayKey(t.exitT); days[dk] = (days[dk] || 0) + pnl;
      if (days[dk] < out.worstDay) { out.worstDay = days[dk]; out.worstDayKey = dk; }
      if (!out.breached) { if (days[dk] <= -s.account * 0.04) out.breached = { type: 'daily 4%', t: t.exitT }; else if (eq <= s.account * 0.90) out.breached = { type: 'max 10%', t: t.exitT }; }
      if (!out.passedAt && eq >= s.account * 1.08) out.passedAt = t.exitT;
    }
    out.winRate = out.n ? out.wins / out.n * 100 : 0;
    out.avgR = out.n ? out.sumR / out.n : 0;
    out.profitFactor = out.grossLoss ? out.grossWin / out.grossLoss : (out.grossWin ? Infinity : 0);
    out.finalEq = eq; out.pnlUSD = eq - s.account; out.riskUSD = riskUSD;
    return out;
  }

  /* ---- Live journal (persists in localStorage) ---- */
  const JKEY = 'gs_journal_v1';
  const Journal = {
    load() { try { return JSON.parse(localStorage.getItem(JKEY) || '[]'); } catch (e) { return []; } },
    save(list) { localStorage.setItem(JKEY, JSON.stringify(list.slice(-500))); },
    has(list, res) { return list.some(x => x.t === res.t && x.side === res.side); },
    add(res, sz) {
      const list = Journal.load();
      if (Journal.has(list, res)) return false;
      list.push({ id: `${res.t}-${res.side}`, t: res.t, side: res.side, grade: res.grade, score: res.score, entry: res.levels.entry, stop: res.levels.stop, tp: res.levels.tp, R: res.levels.R, risk: res.levels.risk, lots: sz.lots, session: res.levels.session, result: 'open', pnlR: 0, note: '' });
      Journal.save(list); return true;
    },
    update(c15, maxBars) {
      const list = Journal.load(); let changed = false;
      for (const j of list) {
        if (j.result !== 'open') continue;
        const start = c15.findIndex(b => b.t > j.t); if (start < 0) continue;
        const long = j.side === 'long';
        for (let k = start; k < c15.length; k++) {
          const b = c15[k];
          if (long ? b.l <= j.stop : b.h >= j.stop) { j.result = 'loss'; j.pnlR = -1; }
          else if (long ? b.h >= j.tp : b.l <= j.tp) { j.result = 'win'; j.pnlR = j.R; }
          else if (k - start >= (maxBars || 96)) { j.result = 'time'; j.pnlR = (long ? b.c - j.entry : j.entry - b.c) / j.risk; }
          if (j.result !== 'open') { j.exitT = b.t; changed = true; break; }
        }
      }
      if (changed) Journal.save(list);
      return list;
    },
    clear() { localStorage.removeItem(JKEY); }
  };

  return { DEFAULTS, RANK, buildContext, detect, size, backtest, stats, Journal };
})();
