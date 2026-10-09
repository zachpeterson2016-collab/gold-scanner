/* DOM rendering: bias chips, setup cards, journal, backtest, settings, toasts. */
const UI = (() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const f1 = v => (v === undefined || v === null || !isFinite(v)) ? '—' : (+v).toFixed(1);
  const usd = v => (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
  const STATUS = {
    NONE: ['No setup', 'The 1H trend does not support this side right now.'],
    TREND: ['Trend OK · waiting for pullback', 'Price is still extended. A setup needs price to come back into the 38–79% zone first.'],
    WATCHING: ['IN ZONE · watching', 'Price is in the pullback zone. Wait for a sweep of 15m liquidity, then a 15m CHoCH/BOS.'],
    WAITING: ['Sweep done · waiting for trigger', 'Liquidity was taken. The next 15m close through structure is your trigger.'],
    TRIGGERED: ['🔔 TRIGGERED now', 'Trigger candle just closed. Check spread/news, then place the order with the ticket below.'],
    ACTIVE: ['Trigger fired · entry still valid', 'Price is still near the entry. Late entries reduce reward — re-check R before taking it.'],
    MISSED: ['Trigger fired · ran away', 'Price already moved more than 0.75R from entry. Do not chase; wait for the next setup.'],
    STOPPED: ['Last trigger failed', 'The stop would have been hit. Structure may be shifting — wait for a fresh sweep + trigger.'],
    DONE: ['Last trigger hit target', 'That trade already completed. Wait for a fresh pullback.']
  };

  function bias(S15, S1h, SD, spotOff, daily, ph, pend) {
    const chip = (tf, k, S) => {
      const d = Structure.describe(S), p = ph && ph[k] ? ph[k][ph[k].length - 1] : null, L = Structure.phaseLabel(p), trend = p && p.trend ? p.trend : d.trend;
      const chop = L.cls === 'range', cls = chop ? 'range' : L.cls === 'warn' ? 'warn' : L.cls === 'shift' ? 'shift' : trend === 'up' ? 'up' : 'down';
      const arrow = chop ? '◆' : trend === 'up' ? '▲' : '▼';
      const word = L.cls === 'warn' ? '<span class="org">⚠ warning</span>' : L.cls === 'shift' ? '<span class="pur">⏳ shifting</span>' : `<span class="${trend === 'up' ? 'grn' : 'red'}">healthy</span>`;
      return `<span class="chip ${cls}" title="${esc(L.short)} — click for the full reading"><span class="arrow">${arrow}</span><b>${tf}</b> ${chop ? '<span class="mut">CHOP</span>' : `${trend.toUpperCase()} · ${word}`}</span>`;
    };
    // live-bar heads-up: the open bar is through a level, but it only counts if it closes there
    const pchip = (tf, k) => {
      const q = pend && pend[k]; if (!q) return '';
      const side = q.dir === 'down' ? 'below' : 'above', lv = (q.level + spotOff).toFixed(1);
      return `<span class="chip shift" title="Heads-up only: it becomes a ${q.type} only if the ${tf} bar CLOSES ${side} ${lv}"><span class="arrow">⏳</span><b>${tf} ${q.type} ${q.dir === 'up' ? '↑' : '↓'} forming</b> <span class="pur">· bar ${side} ${lv} · closes in ${q.minsLeft} min</span></span>`;
    };
    $('#bias').innerHTML = chip('Daily', '1d', SD) + chip('1H', '1h', S1h) + chip('15m', '15m', S15) + pchip('1H', '1h') + pchip('15m', '15m') + `<span class="chip"><span class="mut">Trade in the 1H direction${daily === 'bonus' ? '' : ' · Daily must agree'} · click a chip for details</span></span>`;
  }

  function setupCards(results, s, off, extra) {
    const order = { TRIGGERED: 0, ACTIVE: 1, WAITING: 2, WATCHING: 3, TREND: 4, MISSED: 5, STOPPED: 6, DONE: 7, NONE: 8 };
    const sorted = [...results].sort((a, b) => order[a.status] - order[b.status]);
    // don't wipe the news form while the user is typing in it (render runs every minute)
    const ae = document.activeElement; if (ae && ae.form && $('#tab-setup').contains(ae)) return;
    let html = '';
    if (extra && extra.check) html += tradeCheck(extra.check);
    if (extra && extra.closed) html += `<div class="tip">Market closed — ${esc(extra.closed)}. Showing the state as of the last candle; use this time to study the chart and the Backtest tab.</div>`;
    if (extra && extra.newsWarn) html += `<div class="warn">${esc(extra.newsWarn)}</div>`;
    for (const r of sorted) html += card(r, s, off);
    html += `<div class="note">How to read this: the engine only hunts <b>one</b> pattern — the trend-pullback from diagram 4. 1H trend → pullback into the zone → sweep of 15m liquidity → 15m CHoCH → enter, stop under the sweep, target the last high. Grades: A ≥ 4.5 pts, B ≥ 3, C ≥ 2. Take A/B only.</div>`;
    $('#tab-setup').innerHTML = html;
    if (extra && extra.check) wireNews(extra.onNews);
  }

  // One card that answers "should I be looking at a trade right now?" — every row must be green for a GO.
  let newsOpen = false;
  function tradeCheck(ck) {
    const cls = ck.verdict === 'GO' ? 'go' : ck.verdict === 'WAIT' ? 'wait' : 'no', icon = { ok: '✔', warn: '⚠', no: '✘' };
    let html = `<div class="gonogo ${cls}"><div class="vrow"><span class="verdict ${cls}">${ck.verdict === 'NO' ? 'NO-GO' : ck.verdict}</span><div><b>${esc(ck.reason)}</b><div class="st">Trade check · ${ck.verdict === 'GO' ? 'all five are green' : 'all five must be green for a GO'}</div></div></div>`;
    html += '<ul class="crows">' + ck.rows.map(r => `<li class="${r.state}"><span class="ic">${icon[r.state]}</span><span class="lab">${esc(r.label)}</span><span class="det">${esc(r.detail)}</span></li>`).join('') + '</ul>';
    const now = Date.now(), w = News.wall(now), today = `${w.y}-${String(w.m).padStart(2, '0')}-${String(w.d).padStart(2, '0')}`, man = News.manual().filter(e => e.t > now - 86400000);
    html += `<details class="addnews"${newsOpen ? ' open' : ''}><summary>News schedule · add a time (Fed speech, surprise release)</summary>
      <form id="newsForm"><input type="date" name="d" value="${today}" required><input type="time" name="h" value="09:00" required><input name="n" placeholder="e.g. Powell speaks" maxlength="40" required><button>Add</button></form>
      ${man.length ? '<ul class="manlist">' + man.map(e => `<li>${Data.fmtTime(e.t)} CT · ${esc(e.name)} <button type="button" class="x" data-t="${e.t}" data-n="${esc(e.name)}" title="remove">×</button></li>`).join('') + '</ul>' : ''}
      ${News.stale(now) ? '<div class="st org">⚠ The built-in NFP / CPI dates run out soon — add the newly published ones here.</div>' : ''}
      <div class="st">Built in (Chicago time): FOMC decisions, NFP, CPI = red, no trades ±15 min (FOMC until 2:00 PM). ISM PMIs, jobless claims, FOMC minutes = orange, ±10 min. Both are shaded on the 15m / 1H chart.</div>
    </details></div>`;
    return html;
  }
  function wireNews(onNews) {
    const d = $('#tab-setup details.addnews'); if (d) d.addEventListener('toggle', () => { newsOpen = d.open; });
    const f = $('#newsForm'); if (!f) return;
    f.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(f), [y, m, dd] = String(fd.get('d')).split('-').map(Number), [h, mi] = String(fd.get('h')).split(':').map(Number);
      if (!y || isNaN(h)) return;
      News.addManual(News.ctToMs(y, m, dd, h, mi), String(fd.get('n')).trim() || 'news');
      f.querySelector('[name=n]').blur(); if (onNews) onNews();
    });
    f.parentElement.querySelectorAll('button.x').forEach(b => b.onclick = () => { News.removeManual(+b.dataset.t, b.dataset.n); if (onNews) onNews(); });
  }

  function card(r, s, off) {
    const long = r.side === 'long', [title, hint] = STATUS[r.status] || STATUS.NONE;
    const L = r.levels || {};
    let html = `<div class="card"><h3>${long ? '🟢 LONG' : '🔴 SHORT'} <span class="st">${esc(title)}</span>${r.levels && r.levels.entry !== undefined ? `<span class="badge g-${r.grade}" style="margin-left:auto">GRADE ${r.grade} · ${r.score.toFixed(1)} pts</span>` : ''}</h3>`;
    html += `<div class="st">${esc(hint)}${r.reason ? ` <b>${esc(r.reason)}</b>` : ''}</div>`;
    if (r.checks.length) {
      html += '<ul class="check">' + r.checks.map(c => `<li><span class="${c.ok ? 'ok' : c.soft ? 'soft' : 'no'}">${c.ok ? '✔' : c.soft ? '○' : '✘'}</span><span>${esc(c.label)}</span><span class="d">${esc(c.detail || '')}</span></li>`).join('') + '</ul>';
    }
    if (L.leg) html += `<div class="st">Impulse: ${long ? '1H HL' : '1H LH'} ${f1(L.anchor + off)} → ${f1(L.ext + off)} ($${f1(L.leg)} leg), retraced ${(L.retr * 100).toFixed(0)}%${L.retr > 1 ? ' — wicked through the 1H swing but no 15m close beyond it (a sweep of the higher-timeframe level)' : ''}.</div>`;
    if (L.entry !== undefined) {
      const sz = Setups.size(L, s);
      const tooBig = sz.margin > s.account * 0.9;
      html += `<div class="lv"><div><div class="k">Entry</div><div class="v">${f1(L.entry + off)}</div></div><div><div class="k">Stop</div><div class="v red">${f1(L.stop + off)}</div></div><div><div class="k">Target</div><div class="v grn">${f1(L.tp + off)}</div></div>`
        + `<div><div class="k">Stop distance</div><div class="v">$${f1(L.risk)} · ${sz.ticks} ticks</div></div><div><div class="k">Reward</div><div class="v gold">${L.R.toFixed(1)}R</div></div><div><div class="k">Lots @ ${s.riskPct}%</div><div class="v gold">${sz.lots.toFixed(2)}</div></div></div>`;
      html += `<div class="ticket"><b>TradeLocker ticket</b> (XAUUSD.X, 1 tick = $0.01):<br>1. ${long ? 'BUY' : 'SELL'} · Market · tick <code>Risk</code><br>2. Stop Loss → <code>$${Math.round(sz.riskUSD)}</code> in the $ box (or <code>${sz.ticks}</code> ticks) → lots should read <code>${sz.lots.toFixed(2)}</code><br>3. Take Profit → <code>${sz.tpTicks}</code> ticks ≈ <code>+$${Math.round(sz.rewardUSD)}</code><br>4. Margin ≈ $${Math.round(sz.margin).toLocaleString()} (${sz.marginPct.toFixed(0)}% of account)${tooBig ? ' — <span class="neg">too big for 1:20 leverage, reduce lots</span>' : ''}<br>Loss if stopped: <span class="neg">−$${Math.round(sz.lossUSD)}</span> · Win: <span class="pos">+$${Math.round(sz.rewardUSD)}</span></div>`;
      if (L.risk < 5) html += `<div class="warn">Stop is under $5 — the spread (~$0.95) eats a big slice. Prefer setups with ≥ $5 stops.</div>`;
      html += `<div class="st" style="margin-top:6px">Triggered ${Data.fmtTime(r.t - r.ageBars * 900000)} CT · ${esc(L.session)} · ${esc(L.evType)} ${r.ageBars ? `· ${r.ageBars} bars ago` : ''}${L.tp !== L.tp2 ? ` · runner target ${f1(L.tp2 + off)} (${L.R2.toFixed(1)}R)` : ''}</div>`;
    }
    return html + '</div>';
  }

  function journal(list, s, off) {
    const closed = list.filter(j => j.result !== 'open');
    const st = Setups.stats(closed.map(j => ({ ...j, exitT: j.exitT || j.t })), s);
    let html = `<div class="kpi"><div><div class="k">Logged</div><div class="v">${list.length}</div></div><div><div class="k">Win rate</div><div class="v">${st.n ? st.winRate.toFixed(0) + '%' : '—'}</div></div><div><div class="k">Net R</div><div class="v ${st.sumR >= 0 ? 'pos' : 'neg'}">${st.n ? st.sumR.toFixed(1) : '—'}</div></div></div>`;
    html += `<div class="note">Every A/B trigger seen live is logged here automatically and marked win/loss/time once the chart resolves it. This is your "previous knowledge" growing. Your real fills on TradeLocker will differ a bit (spread, slippage).</div>`;
    if (!list.length) html += '<div class="note">Nothing yet. The first live trigger will appear here.</div>';
    else {
      html += '<table><tr><th>When (CT)</th><th>Side</th><th>Gr</th><th>Entry</th><th>Stop</th><th>TP</th><th>Lots</th><th>Result</th><th>R</th></tr>';
      for (const j of [...list].reverse().slice(0, 60)) html += `<tr><td>${Data.fmtTime(j.t)}</td><td>${j.side === 'long' ? '▲' : '▼'}</td><td><span class="badge g-${j.grade}">${j.grade}</span></td><td>${f1(j.entry + off)}</td><td>${f1(j.stop + off)}</td><td>${f1(j.tp + off)}</td><td>${j.lots.toFixed(2)}</td><td class="${j.pnlR > 0 ? 'pos' : j.result === 'open' ? '' : 'neg'}">${j.result}</td><td class="${j.pnlR > 0 ? 'pos' : j.pnlR < 0 ? 'neg' : ''}">${j.result === 'open' ? '—' : j.pnlR.toFixed(1)}</td></tr>`;
      html += '</table>';
    }
    html += `<div style="margin-top:10px"><button id="jClear">Clear journal</button></div>`;
    $('#tab-journal').innerHTML = html;
    $('#jClear').onclick = () => { if (confirm('Delete the whole journal?')) { Setups.Journal.clear(); journal([], s, off); } };
  }

  function backtest(bt, s, days, minGrade) {
    const st = bt.stats;
    let html = `<div class="note">Replay of the last <b>${days} trading days</b> of 15m candles with exactly the rules on the Setup tab (grade ≥ ${minGrade}, one trade at a time, enter on the trigger close, stop-first if a bar hits both, ${Setups.DEFAULTS.maxBars} bar time-stop, $${(s.account * s.riskPct / 100).toLocaleString()} risked per trade).</div>`;
    html += `<div class="kpi"><div><div class="k">Trades</div><div class="v">${st.n}</div></div><div><div class="k">Win rate</div><div class="v">${st.n ? st.winRate.toFixed(0) + '%' : '—'}</div></div><div><div class="k">Avg R</div><div class="v ${st.avgR >= 0 ? 'pos' : 'neg'}">${st.n ? st.avgR.toFixed(2) : '—'}</div></div>`
      + `<div><div class="k">Net P&L</div><div class="v ${st.pnlUSD >= 0 ? 'pos' : 'neg'}">${usd(st.pnlUSD)}</div></div><div><div class="k">Profit factor</div><div class="v">${st.n ? (isFinite(st.profitFactor) ? st.profitFactor.toFixed(2) : '∞') : '—'}</div></div><div><div class="k">Max drawdown</div><div class="v ${st.maxDD > s.account * 0.05 ? 'neg' : ''}">${usd(-st.maxDD)}</div></div></div>`;
    html += `<canvas id="eq"></canvas>`;
    html += `<div class="st" style="margin:8px 0">Worst day: <b class="${st.worstDay < 0 ? 'neg' : ''}">${usd(st.worstDay)}</b> (limit −$${(s.account * 0.04).toLocaleString()}) · Longest losing streak: <b>${st.maxConsecLoss}</b> · ${st.breached ? `<span class="neg">Would have BREACHED the ${st.breached.type} rule on ${Data.fmtDay(st.breached.t)}</span>` : '<span class="pos">No GFT rule breached</span>'}${st.passedAt ? ` · <span class="pos">+8% target reached ${Data.fmtDay(st.passedAt)}</span>` : ''}</div>`;
    const tbl = (title, m) => { const keys = Object.keys(m); if (!keys.length) return ''; return `<h3 style="font-size:13px;margin:10px 0 4px">${title}</h3><table><tr><th></th><th>Trades</th><th>Win %</th><th>Net R</th></tr>${keys.sort((a, b) => m[b].sumR - m[a].sumR).map(k => `<tr><td>${esc(k)}</td><td>${m[k].n}</td><td>${(m[k].wins / m[k].n * 100).toFixed(0)}%</td><td class="${m[k].sumR >= 0 ? 'pos' : 'neg'}">${m[k].sumR.toFixed(1)}</td></tr>`).join('')}</table>`; };
    html += tbl('By grade', st.byGrade) + tbl('By session', st.bySession) + tbl('By side', st.bySide) + tbl('Daily alignment', st.byDaily) + tbl('Liquidity sweep', st.bySweep);
    if (bt.trades.length) {
      html += `<h3 style="font-size:13px;margin:10px 0 4px">Last trades</h3><table><tr><th>When (CT)</th><th>Side</th><th>Gr</th><th>Sess</th><th>R</th><th>Result</th></tr>`;
      for (const t of bt.trades.slice(-15).reverse()) html += `<tr><td>${Data.fmtTime(t.t)}</td><td>${t.side === 'long' ? '▲' : '▼'}</td><td><span class="badge g-${t.grade}">${t.grade}</span></td><td>${esc(t.session.replace(' KZ', '*'))}</td><td class="${t.pnlR > 0 ? 'pos' : t.pnlR < 0 ? 'neg' : ''}">${t.result === 'open' ? '—' : t.pnlR.toFixed(1)}</td><td>${t.result}</td></tr>`;
      html += '</table>';
    } else html += '<div class="note">No qualifying triggers in this window. Lower the min grade in Settings to see more (lower quality) signals.</div>';
    html += `<div class="note" style="margin-top:8px">⚠ A replay of ${days} trading days is a sanity check, not proof${days < 150 ? ' — the sample is still small' : ''}. Spread, slippage and news spikes are not modelled. Treat any edge here as "worth watching", never "guaranteed".</div>`;
    $('#tab-backtest').innerHTML = html;
    equity(st.equity, s);
  }

  function equity(pts, s) {
    const cv = $('#eq'); if (!cv || !pts.length) return;
    const r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width, H = r.height, lo = Math.min(...pts.map(p => p.eq), s.account * 0.9), hi = Math.max(...pts.map(p => p.eq), s.account * 1.08);
    const X = i => 6 + i / Math.max(1, pts.length - 1) * (W - 12), Y = v => 6 + (hi - v) / (hi - lo || 1) * (H - 12);
    const hl = (v, col, label) => { g.strokeStyle = col; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke(); g.setLineDash([]); g.fillStyle = col; g.font = '10px system-ui'; g.fillText(label, 4, Y(v) - 2); };
    hl(s.account * 1.08, '#26a69a', '+8% pass'); hl(s.account, '#8a93a3', 'start'); hl(s.account * 0.9, '#ef5350', '−10% breach');
    g.strokeStyle = '#f5c542'; g.lineWidth = 1.6; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(i), Y(p.eq)) : g.moveTo(X(i), Y(p.eq))); g.stroke();
  }

  function settings(s, onChange) {
    const sel = (name, opts, val) => `<select name="${name}">${opts.map(o => `<option value="${o[0]}" ${String(o[0]) === String(val) ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>`;
    $('#tab-settings').innerHTML = `<form class="set">
      <label>Account size ($)<input type="number" name="account" value="${s.account}" step="1000" min="1000"></label>
      <label>Risk per trade (%)<input type="number" name="riskPct" value="${s.riskPct}" step="0.25" min="0.1" max="5"></label>
      <label>Leverage on gold (1:x)<input type="number" name="leverage" value="${s.leverage}" step="1" min="1"></label>
      <label>Alert / log for grade ≥${sel('minGrade', [['A', 'A only'], ['B', 'A and B'], ['C', 'A, B and C']], s.minGrade)}</label>
      <label>Sound on new trigger${sel('sound', [['1', 'On'], ['0', 'Off']], s.sound ? 1 : 0)}</label>
      <label>Desktop notifications${sel('notify', [['1', 'On'], ['0', 'Off']], s.notify ? 1 : 0)}</label>
      <label>Show prices as${sel('spotAdjust', [['1', 'Spot-adjusted (≈ TradeLocker)'], ['0', 'Raw PAXG']], s.spotAdjust ? 1 : 0)}</label>
      <label>Trade sessions${sel('sessions', [['ldn_ny', 'London + New York only'], ['all', 'All (incl. Asia — thin)']], s.sessions)}</label>
      <label>Daily trend${sel('daily', [['require', 'Must agree (top-down)'], ['bonus', 'Bonus point only']], s.daily)}</label>
      <label>Target${sel('tpMode', [['tp1', 'Impulse high/low (diagram 4)'], ['auto', 'Auto: next liquidity if it pays more']], s.tpMode)}</label>
      <label>Backtest min grade${sel('btGrade', [['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D (everything)']], s.btGrade)}</label>
      <label>Forecast horizon (15m chart)${sel('fcH', [['8', '2 hours (8 bars)'], ['16', '4 hours (16 bars)'], ['32', '8 hours (32 bars)']], s.fcH)}</label>
      <label>Pattern matches${sel('fcMatch', [['trend', 'Same 1H trend only'], ['any', 'Any past window']], s.fcMatch)}</label>
      <label>Auto-save predictions${sel('fcAuto', [['4', 'Every hour'], ['1', 'Every 15m bar'], ['0', 'Only when I pin']], s.fcAuto)}</label>
    </form>
    <div class="note" style="margin-top:10px">GFT 2 STEPS GOAT 25K: daily loss limit −$1,000 (4%), max drawdown −$2,500 (10%, static), Phase 1 target +$2,000 (8%). At 1% risk that is 4 losses in a day → stop at 2. Settings are saved in this browser.</div>
    <div class="note">Data: candles from Coinbase PAXG-USD (tokenised gold, trades 24/7 — weekend bars are hidden), live spot from gold-api.com. The analysis runs on PAXG; the displayed prices are shifted by the current spot−PAXG difference so they line up with TradeLocker within roughly a dollar.</div>`;
    $('#tab-settings form').addEventListener('change', e => {
      const f = new FormData(e.currentTarget), n = {};
      for (const [k, v] of f.entries()) n[k] = ['account', 'riskPct', 'leverage', 'fcH', 'fcAuto'].includes(k) ? +v : ['sound', 'notify', 'spotAdjust'].includes(k) ? v === '1' : v;
      onChange(n);
    });
  }

  function toast(title, body, ms = 12000) {
    const el = document.createElement('div'); el.className = 'toastItem'; el.innerHTML = `<b>${esc(title)}</b><div class="st" style="margin-top:4px">${esc(body)}</div>`;
    $('#toast').appendChild(el); setTimeout(() => el.remove(), ms);
  }
  function beep() {
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.setValueAtTime(0.0001, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.6); o.start(); o.stop(ac.currentTime + 0.65); } catch (e) { }
  }
  return { bias, setupCards, tradeCheck, journal, backtest, settings, toast, beep, $, esc };
})();
