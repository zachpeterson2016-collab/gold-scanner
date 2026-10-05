/* Forecast tab: the current prediction, live tracking of frozen predictions, and the honesty scoreboard (vs a flat-line baseline). */
UI.forecast = function (m) {
  const $ = UI.$, off = m.off || 0, tf = m.tf, fc = m.fc, sc = m.scen;
  const f1 = v => (v === undefined || v === null || !isFinite(v)) ? '—' : (+v).toFixed(1);
  const px = v => (v === undefined || v === null) ? '—' : f1(v + off);
  const pct = v => (v === undefined || v === null || !isFinite(v)) ? '—' : Math.round(v * 100) + '%';
  const span = (H, t) => t === '15m' ? `${H} bars ≈ ${H / 4} h` : t === '1h' ? `${H} bars ≈ ${H} h` : `${H} trading days`;
  const lean = p => p >= 0.6 ? '▲' : p <= 0.4 ? '▼' : '◆';
  const errTxt = p => (p.err >= 0 ? '+' : '−') + '$' + Math.abs(p.err).toFixed(1);
  const tfName = { '15m': '15-minute', '1h': '1-hour', '1d': 'daily' }[tf];
  let html = '';

  if (!fc) html += `<div class="card"><div class="note">Not enough ${tfName} history for a pattern forecast yet.</div></div>`;
  else {
    const H = fc.H, k = H - 1, end = fc.med[k];
    const word = fc.pUp >= 0.6 ? 'UP' : fc.pUp <= 0.4 ? 'DOWN' : 'SIDEWAYS / unclear', cls = fc.pUp >= 0.6 ? 'grn' : fc.pUp <= 0.4 ? 'red' : 'gold';
    html += `<div class="card"><h3>🔮 Next ${span(H, tf)} <span class="st">from the ${Data.fmtTime(fc.t)} CT close</span></h3>
      <div style="font-size:15px;margin:4px 0"><b class="${cls}">Pattern lean: ${word}</b> <span class="st">— ${Math.round(fc.pUp * 100)}% of the ${fc.k} closest past patterns${fc.matched ? (tf === '15m' ? ' (same 1H trend)' : ` (same ${tfName} trend)`) : ''} ended higher after ${span(H, tf)}</span></div>
      <div class="lv"><div><div class="k">Expected (median)</div><div class="v gold">${px(end)}</div></div><div><div class="k">50% band</div><div class="v">${px(fc.q25[k])}–${px(fc.q75[k])}</div></div><div><div class="k">80% band</div><div class="v">${px(fc.q10[k])}–${px(fc.q90[k])}</div></div></div>
      <div class="st">Move vs now: <b class="${end >= fc.c0 ? 'grn' : 'red'}">${end >= fc.c0 ? '+' : '−'}$${Math.abs(end - fc.c0).toFixed(1)}</b> · one ATR on this chart ≈ $${f1(fc.atr)}. The dotted gold path and shaded cone on the chart are this prediction.</div>`;
    if (sc) {
      const long = sc.side === 'long', od = sc.odds;
      const phase = {
        TREND: `${long ? 'uptrend' : 'downtrend'} on the 1H and price is extended — expect a pullback into <b>${px(sc.zone[0])}–${px(sc.zone[1])}</b> first, then a push to the target`,
        WATCHING: `price is in the ${long ? 'buy' : 'sell'} zone — expect it to hold and push to the target`,
        WAITING: `liquidity was swept inside the zone — expect the trigger, then a push to the target`,
        TRIGGERED: `the setup just triggered — expect the move to the target`,
        ACTIVE: `the setup is live — expect the move to the target`
      }[sc.phase];
      html += `<div class="st" style="margin-top:8px">📐 <b>Structure says ${long ? 'LONG' : 'SHORT'}:</b> ${phase}. Target <b class="grn">${px(sc.target)}</b> · busted if ${sc.bustKind === 'close' ? 'a 15m candle closes' : 'price trades'} ${long ? 'below' : 'above'} <b class="red">${px(sc.bust)}</b>.</div>`;
      if (od && od.n) html += `<div class="st" style="margin-top:4px">📚 In <b>${od.n}</b> similar past spots${od.pooled ? ' (same side, any phase)' : ' (same phase)'}: <b class="grn">${pct(od.target)}</b> reached the target within ${Forecast.CFG['15m'].scen / 4} h${od.medBars ? ` (typically in ${(od.medBars / 4).toFixed(1)} h${sc.needZone ? `, only ${pct(od.viaZone)} of those pulled back into the zone first` : ''})` : ''}, <b class="red">${pct(od.bust)}</b> got busted first, ${pct(od.neither)} did neither.</div>`;
      const agree = (sc.side === 'long') === (fc.pUp >= 0.5);
      html += `<div class="st" style="margin-top:4px">${agree ? '✅ Pattern lean and structure point the same way.' : '⚠ Pattern lean and structure disagree — lower confidence; be picky.'}</div>`;
    } else html += `<div class="st" style="margin-top:8px">📐 <b>Structure:</b> no directional setup right now (1H and Daily not aligned) — expect chop between the last swings. The pattern path above is the only read.</div>`;
    html += `<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"><button id="fcPin">📌 Pin this prediction</button><span class="st">${+m.settings.fcAuto > 0 ? `Auto-saves ${+m.settings.fcAuto === 1 ? 'every bar' : 'every hour'} and whenever the setup phase changes.` : 'Auto-save is off — only pinned predictions are tracked.'}</span></div></div>`;
  }

  const pend = m.live.filter(p => p.status !== 'done').slice(-5).reverse();
  html += `<div class="card"><h3>📡 Tracking live <span class="st">${pend.length ? `— ${pend.length} open` : '— nothing open yet'}</span></h3>`;
  if (!pend.length) html += `<div class="note">The next saved prediction appears here and is re-graded every minute as candles print: predicted vs actual, how far off, inside the band or not.</div>`;
  for (const p of pend) {
    const h = p.n || 0, pr = Math.round(h / p.H * 100), near = h ? (Math.abs(p.err) <= 0.5 * p.atr ? 'grn' : Math.abs(p.err) <= p.atr ? 'gold' : 'red') : '';
    html += `<div class="st" style="padding:6px 0;border-bottom:1px dashed #161c24">
      <div><b>${Data.fmtTime(p.t)}</b> · ${span(p.H, p.tf)} · lean ${lean(p.pUp)} ${Math.round(p.pUp * 100)}% ↑ · <span class="prog"><i style="width:${pr}%"></i></span> ${h}/${p.H} bars</div>
      ${h ? `<div>predicted ${px(p.med[h - 1])} · actual ${px(p.last)} → <b class="${near}">off by ${errTxt(p)}</b> · ${p.inBand === 50 ? 'inside the 50% band ✓' : p.inBand === 80 ? 'inside the 80% band' : 'outside the bands ✗'} · direction so far: <b>${p.dir}</b></div>` : '<div>waiting for the first candle to close…</div>'}
      ${p.sc ? `<div>scenario ${p.sc.side}: zone ${p.scen && p.scen.zoneAt !== null ? 'touched ✓' : (p.sc.needZone ? 'not yet' : 'n/a')} · target ${p.scen && p.scen.outcome === 'target' ? 'HIT 🎯' : '—'} · bust ${p.scen && p.scen.outcome === 'bust' ? 'YES ✗' : '—'}</div>` : ''}</div>`;
  }
  html += '</div>';

  const sl = Forecast.stats(m.live), sb = Forecast.stats(m.back);
  const row = (k, a, b, hint) => `<tr><td>${k}${hint ? ` <span class="st">${hint}</span>` : ''}</td><td>${a}</td><td>${b}</td></tr>`;
  const money = (s, key) => s.n ? '$' + f1(s[key]) : '—';
  html += `<div class="card"><h3>🧾 Scoreboard <span class="st">— is it actually any good?</span></h3><table><tr><th></th><th>Live</th><th>Backfill*</th></tr>
    ${row('Predictions graded', sl.n, sb.n)}
    ${row('Direction right', pct(sl.dirAcc), pct(sb.dirAcc), '(coin flip = 50%)')}
    ${row('Beat the flat line', pct(sl.beatFlat), pct(sb.beatFlat), '(closer than “price stays here”)')}
    ${row('Avg error at each bar', money(sl, 'mae'), money(sb, 'mae'))}
    ${row('Flat-line error', money(sl, 'maeFlat'), money(sb, 'maeFlat'))}
    ${row('Time inside 50% band', pct(sl.cov50), pct(sb.cov50), '(honest cone ≈ 50%)')}
    ${row('Time inside 80% band', pct(sl.cov80), pct(sb.cov80), '(≈ 80%)')}
    ${row('Scenario → target', sl.sn ? `${pct(sl.target)} <span class="st">of ${sl.sn}</span>` : '—', sb.sn ? `${pct(sb.target)} <span class="st">of ${sb.sn}</span>` : '—')}
    ${row('Scenario → busted', sl.sn ? pct(sl.bust) : '—', sb.sn ? pct(sb.bust) : '—')}
    </table><div class="note">*Backfill = the same method run at ${m.back.length} past bars as if it were live (it only sees candles up to each point), so there is a track record from day one. Read it honestly: if “direction right” and “beat the flat line” hover near 50% after a few weeks, the predictor has no real edge — which is the normal result for price prediction. The durable value is in the levels (zone / target / bust) and in watching how price actually behaves against the expectation.</div></div>`;

  const hist = (m.live.length ? m.live : m.back).slice(-20).reverse();
  html += `<div class="card"><h3>📜 Past predictions <span class="st">${m.live.length ? '' : '(backfill — none saved live yet) '}· click a row to see it on the chart</span></h3><table><tr><th>Made (CT)</th><th>Lean</th><th>Predicted</th><th>Actual</th><th>Error</th><th>Dir</th><th>Band</th><th>Scenario</th></tr>`;
  for (const p of hist) {
    const h = p.n || 0, sres = p.sc ? (p.scen ? ({ target: '🎯 target', bust: '✗ bust', neither: 'neither', open: 'open' }[p.scen.outcome]) : 'open') : '—';
    html += `<tr data-id="${p.id}" style="cursor:pointer"><td>${Data.fmtTime(p.t)}</td><td>${lean(p.pUp)} ${Math.round(p.pUp * 100)}%</td><td>${px(p.med[h ? h - 1 : p.H - 1])}</td><td>${h ? px(p.last) : '—'}</td><td class="${h ? (p.mae < p.maeFlat ? 'pos' : 'neg') : ''}">${h ? errTxt(p) : '—'}</td><td>${p.status === 'done' ? (p.dir === 'hit' ? '✓' : p.dir === 'miss' ? '✗' : 'flat') : `${h}/${p.H}`}</td><td>${p.inBand === 50 ? '50%' : p.inBand === 80 ? '80%' : h ? 'out' : '—'}</td><td>${sres}</td></tr>`;
  }
  html += `</table><div class="note">Error = actual price minus the predicted (median) price at the latest graded bar. Green = this prediction was closer than the flat line, red = the flat line would have been closer.</div></div>`;

  $('#tab-forecast').innerHTML = html;
  const pinBtn = $('#fcPin'); if (pinBtn) pinBtn.onclick = m.onPin;
  $('#tab-forecast').querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => { const p = [...m.live, ...m.back].find(x => x.id === tr.dataset.id); if (p) m.onFocus(p); });
};
