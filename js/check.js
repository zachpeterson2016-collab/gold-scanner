/* Go / No-Go: one honest answer to "should I be looking at a trade right now?". It adds no new information — it just lines
   up the five things a beginner skips (direction, setup state, time of day, news, the backtest's verdict on this grade)
   and refuses to say GO while any one of them says no. */
const Check = (() => {
  const ORDER = { TRIGGERED: 0, ACTIVE: 1, WAITING: 2, WATCHING: 3, TREND: 4, MISSED: 5, STOPPED: 6, DONE: 7, NONE: 8 };
  const last = a => a && a.length ? a[a.length - 1] : null;
  const dur = min => min < 60 ? `${Math.max(1, Math.round(min))} min` : min < 60 * 36 ? `${(min / 60).toFixed(min % 60 && min < 600 ? 1 : 0)} h` : `${Math.round(min / 1440)} d`;
  const hm = ms => News.fmtHM(ms);
  // next London (2:00) / New York (7:30) killzone start, scanning minute by minute (market-closed hours included via Data.session)
  function nextKZ(now) { let t = Math.floor(now / 60000) * 60000; for (let i = 0; i < 60 * 24 * 4; i++) { t += 60000; if (Data.session(t).kz) return t; } return null; }

  function build(a) {
    const { results, ph, settings, bt, now, open, nextOpen, days } = a;
    const rows = [], sorted = [...(results || [])].sort((x, y) => ORDER[x.status] - ORDER[y.status]), best = sorted[0] || null;
    const minG = settings.minGrade || 'B';

    // 1 · Direction — the 1H trend (and Daily when required) as the detector sees it, plus the structure reading's health
    const h1 = best && best.htf ? best.htf.h1 : null, dT = best && best.htf ? best.htf.d : null;
    const p1 = last(ph['1h']), L1 = Structure.phaseLabel(p1), needD = settings.daily === 'require';
    let dir;
    if (!h1) dir = { state: 'no', detail: '1H has no clear trend (no HH+HL or LH+LL) — nothing to trade' };
    else if (L1.cls === 'range') dir = { state: 'no', detail: `1H leans ${h1} but it is CHOP — no follow-through, wait for a 1H BOS` };
    else if (needD && dT !== h1) dir = { state: 'no', detail: `1H ${h1} but Daily ${dT || 'unclear'} — against the bigger trend, skip` };
    else if (L1.cls === 'shift') dir = { state: 'warn', detail: `1H shifting ${p1.trend === 'up' ? '▲' : '▼'} — CHoCH only, needs a BOS to confirm` };
    else if (L1.cls === 'warn') dir = { state: 'warn', detail: `${h1 === 'up' ? 'Longs' : 'Shorts'} only · 1H ${h1} but ⚠ ${L1.warnTxt}` };
    else dir = { state: 'ok', detail: `${h1 === 'up' ? 'Longs' : 'Shorts'} only — 1H ${h1}${needD ? ', Daily agrees' : ''}, structure healthy` };
    rows.push(Object.assign({ k: 'dir', label: 'Direction' }, dir));

    // 2 · Setup — where the one pattern we hunt is right now
    const side = best ? best.side.toUpperCase() : '', g = best ? best.grade : 'X', st = best ? best.status : 'NONE', okG = Setups.RANK[g] >= Setups.RANK[minG];
    const SET = {
      TRIGGERED: okG ? ['ok', `${side} grade ${g} — trigger candle just closed, place the ticket below`] : ['no', `${side} triggered but only grade ${g} — below your ${minG} minimum, let it go`],
      ACTIVE: okG ? ['ok', `${side} grade ${g} — entry still valid, re-check the R before taking it`] : ['no', `${side} grade ${g} — below your ${minG} minimum, let it go`],
      WAITING: ['warn', `${side} · sweep done — waiting for the 15m close through structure (trigger)`],
      WATCHING: ['warn', `${side} · in the pullback zone — needs a liquidity sweep, then a 15m CHoCH`],
      TREND: ['warn', `${side} · trend OK — price has not pulled back into the zone yet`],
      MISSED: ['no', `${side} trigger already ran away — do not chase, wait for the next pullback`],
      STOPPED: ['warn', `${side} · last trigger failed — wait for a fresh sweep + trigger`],
      DONE: ['warn', `${side} · last trade finished — wait for a new pullback`],
      NONE: ['no', 'No setup — nothing to trade']
    };
    const [sState, sDetail] = SET[st] || SET.NONE;
    rows.push({ k: 'setup', label: 'Setup', state: sState, detail: sDetail });

    // 3 · Timing — killzones only; the backtest's own numbers for this session when there are enough of them
    const se = Data.session(now), kz = nextKZ(now), kzTxt = kz ? `${Data.session(kz).name} ${hm(kz)} CT (in ${dur((kz - now) / 60000)})` : '';
    let tm;
    if (!open) tm = { state: 'no', detail: `Market closed — reopens ${nextOpen ? Data.fmtTime(nextOpen) + ' CT' : 'soon'}` };
    else if (se.kz) tm = { state: 'ok', detail: `${se.name} ★ — prime window` };
    else if (se.name === 'Asia') tm = { state: settings.sessions === 'all' ? 'warn' : 'no', detail: `Asia — thin and choppy, ${settings.sessions === 'all' ? 'be careful' : 'sit out'} · next killzone ${kzTxt}` };
    else tm = { state: 'warn', detail: `${se.name} — tradeable but not prime · next killzone ${kzTxt}` };
    const bs = bt && bt.stats && bt.stats.bySession && bt.stats.bySession[se.name];
    if (open && bs && bs.n >= 6) tm.detail += ` · replay in this session: ${Math.round(bs.wins / bs.n * 100)}% win, ${bs.sumR >= 0 ? '+' : ''}${bs.sumR.toFixed(1)}R from ${bs.n} trades${bs.n < 15 ? ' (small sample)' : ''}`;
    rows.push(Object.assign({ k: 'time', label: 'Timing' }, tm));

    // 4 · News — inside a window = out; within the hour = don't open anything new
    const blk = News.block(now), nx = News.next(now);
    let nw;
    if (blk) nw = { state: 'no', detail: `${blk.ev.name} ${hm(blk.ev.t)} CT — stay flat until ${hm(blk.until)}` };
    else if (nx && nx.inMin <= 60) nw = { state: 'warn', detail: `${nx.ev.name} in ${dur(nx.inMin)} (${hm(nx.ev.t)} CT) — don't open a trade into it` };
    else if (nx) nw = { state: 'ok', detail: `Clear for ${dur(nx.inMin)} · next: ${nx.ev.name}${nx.ev.est ? ' (unconfirmed)' : ''} ${Data.fmtTime(nx.ev.t)} CT` };
    else nw = { state: 'ok', detail: 'Nothing scheduled' };
    rows.push(Object.assign({ k: 'news', label: 'News' }, nw));

    // 5 · Track record — what the replay says about THIS grade (overall when there is no live setup)
    const hasG = best && best.levels && g !== 'X', bg = bt && bt.stats ? (hasG && bt.stats.byGrade[g] ? bt.stats.byGrade[g] : (bt.stats.n ? { n: bt.stats.n, wins: bt.stats.wins, sumR: bt.stats.sumR } : null)) : null;
    const who = hasG && bt && bt.stats && bt.stats.byGrade[g] ? `Grade ${g}` : `Grade ≥ ${settings.btGrade || minG}`;
    let tr;
    if (!bg || !bg.n) tr = { state: 'warn', detail: 'No backtest trades yet — nothing to lean on' };
    else {
      const wr = Math.round(bg.wins / bg.n * 100), avg = bg.sumR / bg.n, sum = `${bg.n} trades · ${wr}% win · ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}R per trade${days ? ` over ${days} days` : ''}`;
      if (bg.n < 20) tr = { state: 'warn', detail: `${who}: ${sum} — too few to trust yet` };
      else if (avg > 0) tr = { state: 'ok', detail: `${who}: ${sum}` };
      else tr = { state: 'no', detail: `${who}: ${sum} — this loses in the replay, don't take it` };
    }
    rows.push(Object.assign({ k: 'bt', label: 'Track record' }, tr));

    // Verdict
    const R = Object.fromEntries(rows.map(r => [r.k, r]));
    let verdict, reason;
    if (!open) { verdict = 'NO'; reason = R.time.detail; }
    else if (blk) { verdict = 'NO'; reason = R.news.detail; }
    else if (R.dir.state === 'no') { verdict = 'NO'; reason = R.dir.detail; }
    else if (R.setup.state === 'no') { verdict = st === 'NONE' ? 'WAIT' : 'NO'; reason = st === 'NONE' ? `No setup yet — ${h1 === 'up' ? 'longs' : 'shorts'} only, wait for a pullback into the zone` : R.setup.detail; }
    else if (R.bt.state === 'no') { verdict = 'NO'; reason = R.bt.detail; }
    else if (R.setup.state === 'ok') {
      if (R.time.state === 'no') { verdict = 'NO'; reason = `Valid ${side} setup but ${R.time.detail}`; }
      else if (R.news.state === 'warn') { verdict = 'WAIT'; reason = `Valid ${side} setup but ${R.news.detail}`; }
      else { verdict = 'GO'; reason = R.setup.detail; }
    } else { verdict = 'WAIT'; reason = R.time.state === 'no' ? `Nothing to do until the ${kzTxt || 'next killzone'}` : R.setup.detail; }
    return { verdict, reason, rows, side: best ? best.side : null, grade: g, status: st };
  }
  return { build, nextKZ };
})();
