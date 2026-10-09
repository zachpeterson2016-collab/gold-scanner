/* App bootstrap: load history → analyse → scan → render; refresh every 60 s; alerts + journal. */
(() => {
  const $ = UI.$;
  const SKEY = 'gs_settings_v1';
  const DEF = { account: 25000, riskPct: 1, leverage: 20, minGrade: 'B', sound: true, notify: false, spotAdjust: true, btGrade: 'B', sessions: 'ldn_ny', tpMode: 'tp1', daily: 'require', fcH: 16, fcMatch: 'trend', fcAuto: 4 };
  const settings = Object.assign({}, DEF, JSON.parse(localStorage.getItem(SKEY) || '{}'));
  const raw = { '15m': [], '1h': [], '1d': [] };   // all PAXG candles incl. weekends
  const cand = { '15m': [], '1h': [], '1d': [] };  // market-hours only
  const S = {}; let ctx = null, results = [], spot = null, offset = 0, tf = '15m', bt = null, btKey = '';
  let closed = { '15m': [], '1h': [], '1d': [] }, fc = {}, scen = null, preds = [], back = {}, backKey = '', focusPred = null;
  const ph = {}, pst = {}, frm = {}, pend = {}; let phaseKey = {}; const pendSeen = new Set();   // structure reading layer: per-bar phases, chart-specific odds, forming swings, live-bar pending CHoCH/BOS
  const HTF = { '15m': '1h', '1h': '1d', '1d': null }, TFNAME = { '15m': '15m', '1h': '1H', '1d': 'D' };
  const ov = { swings: true, events: true, liq: true, htf: true, setup: true, sessions: false, forecast: true };
  const seen = new Set(JSON.parse(localStorage.getItem('gs_seen') || '[]'));
  const TARGET = { '15m': 6000, '1h': 2000, '1d': 320 }; // ≈ 62 days of 15m, 83 days of 1H — loaded first so the screen is up fast
  const DEEP = { '1h': 13000, '15m': 36000 };            // then ≈ 1 year of 15m and all 1H since Coinbase listed PAXG, for an honest backtest

  const setDot = (cls, title) => { const d = $('#dot'); d.className = 'dot ' + cls; d.title = title || ''; };
  const save = () => localStorage.setItem(SKEY, JSON.stringify(settings));

  async function loadHistory() {
    setDot('busy', 'loading history');
    for (const k of ['1d', '1h', '15m']) {
      raw[k] = await Data.fetchHistory(k, TARGET[k], (t, got, want) => { $('#updated').textContent = `loading ${t}: ${Math.min(got, want)}/${want} candles`; });
    }
  }
  async function refresh() {
    try {
      setDot('busy', 'refreshing');
      const [c15, c1h, c1d] = await Promise.all([Data.fetchLatest('15m'), Data.fetchLatest('1h'), Data.fetchLatest('1d')]);
      raw['15m'] = Data.merge(raw['15m'], c15); raw['1h'] = Data.merge(raw['1h'], c1h); raw['1d'] = Data.merge(raw['1d'], c1d);
      try { spot = await Data.fetchSpot(); } catch (e) { /* keep old spot */ }
      if (window.Predict) await Predict.reload();
      analyse(); render();
      setDot('ok', 'live'); $('#updated').textContent = `updated ${Data.fmtClock(Date.now())} CT`;
    } catch (e) { console.error(e); setDot('err', e.message); $('#updated').textContent = 'feed error: ' + e.message; }
  }

  function analyse() {
    for (const k of ['15m', '1h', '1d']) cand[k] = Data.filterOpen(raw[k], k);
    // drop the still-forming last bar so signals are based on closed candles only
    closed = {};
    for (const k of ['15m', '1h', '1d']) { const g = Data.GRAN[k] * 1000, a = cand[k]; closed[k] = a.length && a[a.length - 1].t + g > Date.now() ? a.slice(0, -1) : a; }
    S['15m'] = Structure.analyze(closed['15m'], { L: 3, R: 3, atrMult: 0.6 });
    S['1h'] = Structure.analyze(closed['1h'], { L: 3, R: 3, atrMult: 0.6 });
    S['1d'] = Structure.analyze(closed['1d'], { L: 2, R: 2, atrMult: 0.5 });
    for (const k of ['15m', '1h', '1d']) { ph[k] = Structure.phases(S[k]); pst[k] = Structure.phaseStats(S[k], ph[k]); frm[k] = Structure.forming(S[k]); }
    structureAlerts();
    ctx = Setups.buildContext(closed['15m'], S['15m'], S['1h'], S['1d'], { sessions: settings.sessions, tpMode: settings.tpMode, daily: settings.daily });
    const last = closed['15m'].length - 1;
    results = last >= 0 ? ['long', 'short'].map(side => Setups.detect(ctx, last, side)) : [];
    const lastPx = closed['15m'].length ? closed['15m'][last].c : null;
    offset = (settings.spotAdjust && spot && lastPx) ? spot.price - lastPx : 0;
    alerts(); journalUpdate();
    const key = `${closed['15m'].length}|${settings.account}|${settings.riskPct}|${settings.btGrade}|${settings.sessions}|${settings.tpMode}|${settings.daily}`;
    if (key !== btKey) { bt = Setups.backtest(ctx, settings, { minGrade: settings.btGrade }); btKey = key; }
    forecastAll();
  }

  const cfgFor = k => k === '15m' ? Object.assign({}, Forecast.CFG[k], { H: +settings.fcH || 16 }) : Forecast.CFG[k];
  // "same state" for pattern matching = the 1H trend at that bar (own trend for the 1H / Daily charts)
  const fcOpts = k => ({ stateOf: settings.fcMatch === 'trend' ? (k === '15m' ? i => { const j = ctx.h1Idx[i]; return j >= 0 ? S['1h'].trendAt[j] : null; } : i => S[k].trendAt[i]) : null });
  function forecastAll() {
    for (const k of ['15m', '1h', '1d']) fc[k] = closed[k].length ? Forecast.path(closed[k], S[k], closed[k].length - 1, cfgFor(k), fcOpts(k)) : null;
    const i = closed['15m'].length - 1;
    scen = i >= 0 ? Forecast.scenarioAt(ctx, i) : null;
    if (scen) scen.odds = Forecast.odds(Forecast.classify(ctx, Forecast.CFG['15m'].scen), scen);
    let list = Forecast.load();
    for (const k of ['15m', '1h', '1d']) list = Forecast.autoLog(list, k, fc[k], k === '15m' ? scen : null, k === '15m' ? +settings.fcAuto : (+settings.fcAuto > 0 ? (k === '1h' ? 4 : 1) : 0), closed[k]);
    const finished = Forecast.score(list, closed);
    Forecast.save(list); preds = list;
    for (const p of finished) UI.toast('Prediction graded', `${p.tf} · made ${Data.fmtTime(p.t)} CT · predicted ${(p.med[p.H - 1] + offset).toFixed(1)}, actual ${(p.last + offset).toFixed(1)} → off by $${Math.abs(p.err).toFixed(1)} · ${p.mae < p.maeFlat ? 'beat the flat line ✓' : 'flat line was closer ✗'}`, 15000);
    const bk = ['15m', '1h', '1d'].map(k => closed[k].length).join('|') + `|${settings.fcH}|${settings.fcMatch}`;
    if (bk !== backKey) {
      const plan = { '15m': [4, 240], '1h': [2, 120], '1d': [1, 60] };
      for (const k of ['15m', '1h', '1d']) back[k] = closed[k].length ? Forecast.backfill(k, closed[k], S[k], cfgFor(k), fcOpts(k), plan[k][0], plan[k][1], k === '15m' ? ctx : null) : [];
      backKey = bk;
    }
  }
  function pin() {
    const r = Forecast.pin(Forecast.load(), tf, fc[tf], tf === '15m' ? scen : null);
    if (r.added) { Forecast.score(r.list, closed); Forecast.save(r.list); preds = r.list; render(); UI.toast('Prediction pinned', `${tf} · from the ${Data.fmtTime(fc[tf].t)} CT close · graded live on the Forecast tab and drawn on the chart.`, 6000); }
    else UI.toast('Already saved', fc[tf] ? 'This bar\'s prediction is already in the log.' : 'No forecast available for this timeframe yet.', 4000);
  }
  function focusOn(p) {
    focusPred = p.id; clearRange();
    if (p.tf !== tf) { tf = p.tf; document.querySelectorAll('.tf').forEach(x => x.classList.toggle('on', x.dataset.tf === tf)); }
    render();
    const i0 = Forecast.idxAt(cand[tf], p.t); if (i0 >= 0) Chart.focus(i0 + Math.round(p.H / 2));
  }

  function alerts() {
    const inNews = News.block(Date.now());
    for (const r of results) {
      if (r.status !== 'TRIGGERED' || Setups.RANK[r.grade] < Setups.RANK[settings.minGrade]) continue;
      const id = `${r.t}-${r.side}`; if (seen.has(id)) continue;
      seen.add(id); localStorage.setItem('gs_seen', JSON.stringify([...seen].slice(-200)));
      const sz = Setups.size(r.levels, settings);
      Setups.Journal.add(r, sz);
      const msg = `${r.side.toUpperCase()} grade ${r.grade} · entry ${(r.levels.entry + offset).toFixed(1)} · stop ${(r.levels.stop + offset).toFixed(1)} ($${Math.round(sz.riskUSD)}) · TP ${(r.levels.tp + offset).toFixed(1)} (${r.levels.R.toFixed(1)}R) · ${sz.lots.toFixed(2)} lots${inNews ? ` · ⚠ inside the ${inNews.ev.name} window — SKIP this one` : ''}`;
      UI.toast(inNews ? '⚠ Setup triggered in a NEWS window — skip' : '🔔 Gold setup triggered', msg, 30000);
      if (settings.sound) UI.beep();
      if (settings.notify && 'Notification' in window && Notification.permission === 'granted') new Notification('Gold setup triggered', { body: msg });
    }
  }
  function journalUpdate() { Setups.Journal.update(cand['15m'], Setups.DEFAULTS.maxBars); }
  // Toast when the 1H or 15m structure health changes (first run only records the state).
  function structureAlerts() {
    const first = !Object.keys(phaseKey).length;
    for (const k of ['1h', '15m']) {
      const p = ph[k][ph[k].length - 1]; if (!p) continue;
      const key = `${p.phase}|${p.trend}|${p.warn.join()}|${p.since}`;
      if (!first && phaseKey[k] !== key) {
        const L = Structure.phaseLabel(p), lv = p.key ? ` · ${p.trend === 'up' ? 'holds above' : 'holds below'} ${(p.key.p + offset).toFixed(1)}` : '';
        UI.toast(`${TFNAME[k]} structure: ${L.short}`, `${p.trend === 'up' ? '▲ up' : p.trend === 'down' ? '▼ down' : ''}${lv}${p.ev ? ` · last event ${p.ev.type} ${p.ev.dir === 'up' ? '↑' : '↓'} ${Data.fmtTime(closed[k][p.ev.i].t)} CT` : ''}. Open the Structure tab for the full reading.`, 15000);
      }
      phaseKey[k] = key;
    }
  }
  const htfFor = k => HTF[k] ? { name: TFNAME[HTF[k]], S: S[HTF[k]], ph: ph[HTF[k]], gran: Data.GRAN[HTF[k]] * 1000 } : null;
  // Live-bar heads-up: is the still-open 1H / 15m bar trading through a structure level right now? Toast once per bar.
  function pendingUpdate(now) {
    for (const k of ['1h', '15m']) {
      const a = cand[k], cl = closed[k];
      pend[k] = Structure.pending(ph[k] && ph[k][ph[k].length - 1], a[a.length - 1], cl[cl.length - 1], Data.GRAN[k] * 1000, now);
      const q = pend[k]; if (!q) continue;
      const id = `${k}|${q.type}|${q.dir}|${q.barT}`; if (pendSeen.has(id)) continue;
      pendSeen.add(id);
      UI.toast(`⏳ ${TFNAME[k]} ${q.type} ${q.dir === 'up' ? '↑' : '↓'} forming`, `The open ${TFNAME[k]} bar is ${q.dir === 'down' ? 'below' : 'above'} ${(q.level + offset).toFixed(1)} — it only counts if it CLOSES there (${q.minsLeft} min left). Heads-up, not a trade.`, 20000);
    }
  }

  function render() {
    if (!S['15m']) return;
    const off = offset;
    $('#spot').textContent = spot ? spot.price.toFixed(2) : '—';
    const lp = cand['15m'].length ? cand['15m'][cand['15m'].length - 1].c : null;
    $('#paxg').textContent = lp ? `PAXG ${lp.toFixed(2)}` : 'PAXG —';
    $('#offset').textContent = spot && lp ? `(spot − PAXG = ${(spot.price - lp) >= 0 ? '+' : ''}${(spot.price - lp).toFixed(2)}${settings.spotAdjust ? ', chart adjusted' : ''})` : '';
    const now = Date.now(), open = Data.isOpen(now), nx = Data.nextOpen(now);
    pendingUpdate(now);
    UI.bias(S['15m'], S['1h'], S['1d'], off, settings.daily, ph, pend);
    const check = Check.build({ results, ph, settings, bt, now, open, nextOpen: nx, days: btDays() });
    UI.setupCards(results, settings, off, { closed: open ? null : `reopens ${nx ? Data.fmtTime(nx) + ' CT' : 'soon'}`, check, onNews: render });
    const active = $('#tab-journal').classList.contains('on'), btOn = $('#tab-backtest').classList.contains('on'), fcOn = $('#tab-forecast').classList.contains('on'), stOn = $('#tab-structure').classList.contains('on'), pdOn = $('#tab-predict').classList.contains('on');
    if (active) UI.journal(Setups.Journal.load(), settings, off);
    if (pdOn) UI.predict({ list: window.PREDICTIONS || [], c15: cand['15m'], off, now });
    if (btOn && bt) UI.backtest(bt, settings, btDays(), settings.btGrade);
    if (fcOn) UI.forecast({ tf, fc: fc[tf], scen, live: preds.filter(p => p.tf === tf), back: back[tf] || [], off, settings, onPin: pin, onFocus: focusOn });
    if (stOn) UI.structure({ tf, S, ph, pst, frm, closed, off, onTf: setTf });
    Chart.setData({ tf, c: cand[tf], S: S[tf], offset: off, setups: tf === '15m' ? results : [], ov, htf: htfFor(tf), fc: fc[tf] || null, scen, preds: preds.filter(p => p.tf === tf), focus: focusPred, ph: ph[tf], forming: frm[tf], gran: Data.GRAN[tf] * 1000, news: tf === '1d' ? [] : News.upcoming(now - 2 * 86400000, now + 3 * 86400000) });
  }
  // trading days covered by the 15m replay (≈ 92 market-hour bars per day)
  const btDays = () => ctx ? Math.round(ctx.c15.length / 92) : 0;
  function setTf(k) { clearRange(); tf = k; document.querySelectorAll('.tf').forEach(x => x.classList.toggle('on', x.dataset.tf === tf)); Chart.toEnd(); render(); }

  // Range buttons (1D … 5Y). Each shows the last N trading days on the finest timeframe that has the history and still
  // leaves ≥ 2.5 px per bar; otherwise Daily (which gets ≈ 6 years once the deep history has loaded).
  const RANGES = { '1D': 1, '5D': 5, '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '5Y': 1260 }, BARS_PER_DAY = { '15m': 92, '1h': 23, '1d': 1 };
  let range = null;
  function pickRange(name) {
    const days = RANGES[name], pw = Math.max(200, Chart.state.W - 80);
    for (const k of ['15m', '1h']) { const bars = days * BARS_PER_DAY[k]; if (cand[k].length >= bars && pw / bars >= 2.5) return { tf: k, bars }; }
    return { tf: '1d', bars: days };
  }
  function applyRange(name) {
    if (!RANGES[name] || !S['15m']) return;
    const r = pickRange(name); range = name;
    if (r.tf !== tf) { tf = r.tf; document.querySelectorAll('.tf').forEach(x => x.classList.toggle('on', x.dataset.tf === tf)); render(); }
    Chart.showLast(r.bars);
    document.querySelectorAll('.rng').forEach(x => x.classList.toggle('on', x.dataset.r === name));
  }
  function clearRange() { if (!range) return; range = null; document.querySelectorAll('.rng').forEach(x => x.classList.remove('on')); }
  // Older daily candles (≈ 6 years, spliced from other exchanges) for the 1Y / 5Y views and better Daily odds — fetched after the first render.
  async function loadDeep() {
    try {
      const before = raw['1d'].length, deep = await Data.deepDaily(raw['1d']);
      if (deep.length <= before) return;
      raw['1d'] = Data.merge(deep, raw['1d']); analyse(); render(); if (range) applyRange(range);
      $('#updated').textContent = `daily history now back to ${Data.fmtMonthYear(raw['1d'][0].t)} (${cand['1d'].length} × D) · ${Data.fmtClock(Date.now())} CT`;
    } catch (e) { console.warn('deep daily history', e); }
  }
  // Older 15m / 1H candles (≈ 1 year) so the backtest and the odds tables rest on hundreds of trading days instead of ~45.
  // Paged from Coinbase in the background (~1 min the first time), then served from this browser's cache.
  let deepBusy = false;
  async function loadDeepIntraday() {
    if (deepBusy) return; deepBusy = true;
    try {
      let grew = false;
      for (const k of ['1h', '15m']) {
        const before = raw[k].length;
        const deep = await Data.deepIntraday(k, raw[k], DEEP[k], (t, got, want) => { $('#updated').textContent = `loading ${t === '1h' ? '1H' : t} history: ${Math.min(got, want).toLocaleString()} / ${want.toLocaleString()} candles`; });
        raw[k] = Data.merge(deep, raw[k]); if (raw[k].length > before) grew = true;
      }
      if (!grew) return;
      analyse(); render(); if (range) applyRange(range);
      $('#updated').textContent = `15m history back to ${Data.fmtMonthYear(raw['15m'][0].t)} · backtest now ${btDays()} trading days, ${bt ? bt.stats.n : 0} trades · ${Data.fmtClock(Date.now())} CT`;
    } catch (e) { console.warn('deep intraday history', e); $('#updated').textContent = `extra history unavailable (${e.message}) · ${Data.fmtClock(Date.now())} CT`; }
    finally { deepBusy = false; }
  }

  function clock() {
    const now = Date.now(), se = Data.session(now), open = Data.isOpen(now);
    const nx = open ? null : Data.nextOpen(now);
    $('#clock').textContent = `${Data.fmtClock(now)} CT · ${open ? se.name + (se.kz ? ' ★' : '') : 'CLOSED' + (nx ? ' · opens ' + Data.fmtTime(nx) : '')}`;
  }

  function wire() {
    document.querySelectorAll('.tf').forEach(b => b.onclick = () => setTf(b.dataset.tf));
    document.querySelectorAll('.rng').forEach(b => b.onclick = () => applyRange(b.dataset.r));
    Chart.onUserView(clearRange);
    document.querySelectorAll('.tog').forEach(b => b.onclick = () => { b.classList.toggle('on'); ov[b.dataset.ov] = b.classList.contains('on'); render(); });
    $('#zoomIn').onclick = () => Chart.zoom(1 / 1.3); $('#zoomOut').onclick = () => Chart.zoom(1.3); $('#toEnd').onclick = () => Chart.toEnd();
    document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => openTab(b.dataset.tab));
    $('#bias').addEventListener('click', () => openTab('structure'));
    window.addEventListener('keydown', e => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); Chart.pan(e.shiftKey ? -1 : -0.5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); Chart.pan(e.shiftKey ? 1 : 0.5); }
      else if (e.key === '+' || e.key === '=') Chart.zoom(1 / 1.3);
      else if (e.key === '-') Chart.zoom(1.3);
      else if (e.key === 'End') Chart.toEnd();
      else if (e.key === 'Home') Chart.toStart();
    });
  }
  function openTab(name) {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === name));
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x.id === 'tab-' + name));
    if (name === 'settings') UI.settings(settings, onSettings);
    render();
  }
  function onSettings(n) {
    Object.assign(settings, n); save();
    if (settings.notify && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    analyse(); render(); UI.toast('Settings saved', `Account $${settings.account.toLocaleString()} · risk ${settings.riskPct}% · alerts for grade ≥ ${settings.minGrade}`, 4000);
  }

  async function main() {
    Chart.init($('#chart'), $('#hover'), $('#hscroll'));
    wire(); clock(); setInterval(clock, 1000);
    try {
      await loadHistory();
      try { spot = await Data.fetchSpot(); } catch (e) { }
      analyse(); render();
      setDot('ok', 'live'); $('#updated').textContent = `loaded ${cand['15m'].length} × 15m, ${cand['1h'].length} × 1H, ${cand['1d'].length} × D · ${Data.fmtClock(Date.now())} CT`;
      UI.toast('Scanner ready', `${cand['15m'].length} fifteen-minute candles analysed. Refreshing every 60 s.`, 6000);
      loadDeep().then(loadDeepIntraday);
    } catch (e) { console.error(e); setDot('err', e.message); $('#updated').textContent = 'load failed: ' + e.message; $('#tab-setup').innerHTML = `<div class="warn">Could not load candles: ${e.message}. Check your internet connection, then reload.</div>`; }
    setInterval(refresh, 60000);
  }
  window.GS = { settings, raw, cand, S, ph, pst, frm, pend, get ctx() { return ctx; }, get results() { return results; }, get bt() { return bt; }, get fc() { return fc; }, get scen() { return scen; }, get preds() { return preds; }, get back() { return back; }, get closed() { return closed; }, get range() { return range; }, refresh, analyse, render, pin, openTab, applyRange, loadDeep, loadDeepIntraday, btDays };
  main();
})();
