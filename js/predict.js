/* Prediction test: Copilot's forward calls (BUY / SELL / FLAT) from predictions.json, graded automatically from the 15m candles.
   A call is never edited after it is made — the file is committed to GitHub with a timestamp (see tools/predict.ps1). */
const Predict = (() => {
  const HOUR = 3600000;
  const isRight = p => p.outcome === 'win' || p.outcome === 'hit' || (p.outcome === 'expired' && p.R > 0);

  // list: raw entries {id, t, px, off, side, entry?, stop?, target?, band?, hours, conf, why}; c15: PAXG candles; off: current spot offset
  function score(list, c15, off, now) {
    return (list || []).map(p => {
      const t = typeof p.t === 'number' ? p.t : Date.parse(p.t);
      const o = (p.off !== undefined && p.off !== null) ? +p.off : off; // grade on the TradeLocker scale that was in force when the call was made
      const exp = t + (+p.hours || 4) * HOUR;
      const r = Object.assign({}, p, { t, exp, status: 'open', outcome: null, R: null, openR: null, fillT: null, doneT: null, last: null, mfe: 0, mae: 0, move: 0 });
      const bars = c15.filter(c => c.t >= t && c.t < exp).map(c => ({ t: c.t, o: c.o + o, h: c.h + o, l: c.l + o, c: c.c + o }));
      if (!bars.length) { if (now >= exp) { r.status = 'done'; r.outcome = 'nodata'; } return r; }
      r.last = bars[bars.length - 1].c; r.move = r.last - p.px;
      if (p.side === 'flat') {
        const band = +p.band || 5;
        for (const b of bars) if (b.h >= p.px + band || b.l <= p.px - band) { r.status = 'done'; r.outcome = 'miss'; r.doneT = b.t; break; }
        if (r.status === 'open' && now >= exp) { r.status = 'done'; r.outcome = 'hit'; r.doneT = exp; }
        return r;
      }
      const buy = p.side === 'buy', entry = +p.entry || +p.px, stop = +p.stop, target = +p.target;
      const risk = Math.abs(entry - stop), rr = risk ? Math.abs(target - entry) / risk : 0;
      r.entry = entry; r.rr = rr;
      let i = 0, filled = Math.abs(entry - p.px) < 0.05; // market call fills at once; otherwise wait for price to reach the limit level
      if (filled) r.fillT = t;
      else {
        for (; i < bars.length; i++) { const b = bars[i]; if (buy ? b.l <= entry : b.h >= entry) { filled = true; r.fillT = b.t; break; } }
        if (!filled) { if (now >= exp) { r.status = 'done'; r.outcome = 'nofill'; } else r.status = 'pending'; return r; }
      }
      for (; i < bars.length; i++) {
        const b = bars[i];
        r.mfe = Math.max(r.mfe, buy ? b.h - entry : entry - b.l); r.mae = Math.max(r.mae, buy ? entry - b.l : b.h - entry);
        if (buy ? b.l <= stop : b.h >= stop) { r.status = 'done'; r.outcome = 'loss'; r.R = -1; r.doneT = b.t; break; } // stop and target in one candle = loss
        if (buy ? b.h >= target : b.l <= target) { r.status = 'done'; r.outcome = 'win'; r.R = rr; r.doneT = b.t; break; }
      }
      if (r.status !== 'done') {
        r.openR = risk ? (buy ? r.last - entry : entry - r.last) / risk : 0;
        if (now >= exp) { r.status = 'done'; r.outcome = 'expired'; r.R = Math.max(-1, Math.min(rr, r.openR)); r.doneT = exp; }
      }
      return r;
    });
  }

  function stats(scored) {
    const done = scored.filter(p => p.status === 'done' && p.outcome !== 'nofill' && p.outcome !== 'nodata');
    const trades = done.filter(p => p.side !== 'flat');
    const right = done.filter(isRight).length, sumR = trades.reduce((s, p) => s + (p.R || 0), 0);
    const byConf = {};
    for (const p of done) { const k = p.conf >= 4 ? 'high' : +p.conf === 3 ? 'mid' : 'low'; byConf[k] = byConf[k] || { n: 0, right: 0 }; byConf[k].n++; if (isRight(p)) byConf[k].right++; }
    const n = done.length, acc = n ? right / n : null, avgR = trades.length ? sumR / trades.length : null;
    let grade = '—', gradeNote = `too early (${n}/10 graded)`;
    if (n >= 10) {
      if (acc >= 0.65 && avgR !== null && avgR >= 0.3) { grade = 'A'; gradeNote = 'real edge so far'; }
      else if (acc >= 0.55 && (avgR === null || avgR > 0)) { grade = 'B'; gradeNote = 'promising'; }
      else if (acc >= 0.5 || (avgR !== null && avgR > 0)) { grade = 'C'; gradeNote = 'coin-flip territory'; }
      else { grade = 'D'; gradeNote = 'no edge — do not follow these calls'; }
    }
    return { n, right, acc, trades: trades.length, wins: trades.filter(p => p.outcome === 'win').length, sumR, avgR, byConf, grade, gradeNote,
      open: scored.filter(p => p.status === 'open' || p.status === 'pending').length, nofill: scored.filter(p => p.outcome === 'nofill').length };
  }

  // one-line summary for chat / phone pushes
  function line(scored) {
    const s = stats(scored);
    if (!s.n) return `Prediction test: ${s.open} open · nothing graded yet`;
    return `Prediction test: ${s.right}/${s.n} right (${Math.round(s.acc * 100)}%)${s.trades ? ` · ${s.sumR >= 0 ? '+' : '−'}${Math.abs(s.sumR).toFixed(1)}R` : ''} · grade ${s.grade} (${s.gradeNote}) · ${s.open} open`;
  }

  // re-pull predictions.js (works on file:// and Pages; cache-busted) so new calls show up without a page reload
  function reload() {
    return new Promise(resolve => {
      const s = document.createElement('script');
      s.src = 'predictions.js?v=' + Date.now();
      s.onload = () => { s.remove(); resolve(window.PREDICTIONS || []); };
      s.onerror = () => { s.remove(); resolve(window.PREDICTIONS || []); };
      document.head.appendChild(s);
    });
  }

  return { score, stats, line, isRight, reload };
})();

/* Test tab */
UI.predict = function (m) {
  const $ = UI.$;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const f1 = v => (v === undefined || v === null || !isFinite(v)) ? '—' : (+v).toFixed(1);
  const R = v => (v === undefined || v === null || !isFinite(v)) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2) + 'R';
  const usd = v => (v < 0 ? '−' : '+') + '$' + Math.abs(v).toFixed(1);
  const stars = c => '★'.repeat(+c || 3) + '☆'.repeat(5 - (+c || 3));
  const scored = Predict.score(m.list, m.c15, m.off, m.now), st = Predict.stats(scored);
  const sideTxt = p => p.side === 'flat' ? `FLAT ${f1(p.px)} ± $${f1(p.band)}` : `${p.side.toUpperCase()} ${f1(p.entry || p.px)}${Math.abs((p.entry || p.px) - p.px) >= 0.05 ? ' (limit)' : ''} · stop ${f1(p.stop)} · target ${f1(p.target)} (${f1(p.rr)}R)`;
  const outTxt = p => ({ win: '🎯 WIN', loss: '✗ LOSS', hit: '✓ RIGHT · stayed in band', miss: '✗ WRONG · left the band', expired: p.R > 0 ? '⏱ expired ahead' : '⏱ expired behind', nofill: '— never filled', nodata: '— no data' }[p.outcome] || (p.status === 'pending' ? '⏳ waiting for fill' : '⏳ open'));
  const cls = p => Predict.isRight(p) ? 'grn' : (p.outcome === 'loss' || p.outcome === 'miss' || p.outcome === 'expired') ? 'red' : 'gold';
  const gcls = { A: 'grn', B: 'grn', C: 'gold', D: 'red' }[st.grade] || 'gold';
  let html = `<div class="card"><h3>🧪 Prediction test <span class="st">— Copilot's calls, graded by the market</span></h3>
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:6px 0">
      <div class="${gcls}" style="font-size:34px;font-weight:700;line-height:1">${st.grade}</div>
      <div><div><b>${st.n}</b> graded · <b class="${st.acc === null ? '' : st.acc >= 0.5 ? 'grn' : 'red'}">${st.n ? `${st.right}/${st.n} right (${Math.round(st.acc * 100)}%)` : 'nothing graded yet'}</b> · ${st.open} open</div>
      <div class="st">Trades: ${st.trades ? `${st.wins}/${st.trades} wins · total <b class="${st.sumR >= 0 ? 'grn' : 'red'}">${R(st.sumR)}</b> · avg ${R(st.avgR)} per trade` : 'none graded yet'} · ${st.gradeNote}</div></div></div>
    <div class="note">Grades: <b>A</b> ≥ 65% right and ≥ +0.3R avg · <b>B</b> ≥ 55% right with positive R · <b>C</b> coin-flip territory · <b>D</b> losing. Needs 10 graded calls for a grade and 20+ before it means much — a coin flip scores ~50%.<br><b>These are paper calls for learning, not trade signals.</b> The only trade signal is a green <b>GO</b> on the Setup tab.</div></div>`;

  const open = scored.filter(p => p.status === 'open' || p.status === 'pending').reverse();
  html += `<div class="card"><h3>📡 Open calls <span class="st">${open.length ? `— ${open.length}` : '— none right now'}</span></h3>`;
  if (!open.length) html += `<div class="note">The next call appears here and is re-graded every minute as candles print.</div>`;
  for (const p of open) {
    const left = Math.max(0, p.exp - m.now), hrs = Math.floor(left / 3600000), mins = Math.round((left % 3600000) / 60000);
    const live = p.last === null ? 'waiting for the first candle…'
      : p.side === 'flat' ? `now ${f1(p.last)} (${usd(p.move)}) · must stay inside ${f1(p.px - p.band)}–${f1(p.px + p.band)}`
      : p.status === 'pending' ? `now ${f1(p.last)} · waiting for price to reach ${f1(p.entry)}`
      : `now ${f1(p.last)} → <b class="${p.openR >= 0 ? 'grn' : 'red'}">${R(p.openR)}</b> · best ${usd(p.mfe)} · worst ${usd(-p.mae)}`;
    html += `<div class="st" style="padding:6px 0;border-bottom:1px dashed #161c24"><div><b>${esc(p.made || Data.fmtTime(p.t))}</b> · <b class="gold">${sideTxt(p)}</b> · ${stars(p.conf)}</div><div>${live} · ${hrs}h ${mins}m left</div><div class="mut">${esc(p.why)}</div></div>`;
  }
  html += '</div>';

  const done = scored.filter(p => p.status === 'done').reverse();
  html += `<div class="card"><h3>📜 Graded calls <span class="st">${done.length > 30 ? '— last 30' : ''}</span></h3>`;
  if (!done.length) html += `<div class="note">Nothing graded yet.</div>`;
  else {
    html += `<table><tr><th>Made (CT)</th><th>Call</th><th>Result</th><th>R</th><th>Conf</th></tr>`;
    for (const p of done.slice(0, 30)) html += `<tr title="${esc(p.why)}"><td>${esc(p.made || Data.fmtTime(p.t))}</td><td>${sideTxt(p)}</td><td class="${cls(p)}">${outTxt(p)}${p.doneT && p.outcome !== 'expired' && p.outcome !== 'hit' ? ` <span class="st">${Data.fmtTime(p.doneT)}</span>` : ''}</td><td class="${cls(p)}">${p.side === 'flat' ? '—' : R(p.R)}</td><td>${stars(p.conf)}</td></tr>`;
    html += '</table>';
  }
  const cal = ['high', 'mid', 'low'].filter(k => st.byConf[k]).map(k => `${k === 'high' ? '★4–5' : k === 'mid' ? '★3' : '★1–2'}: ${st.byConf[k].right}/${st.byConf[k].n} right`).join(' · ');
  html += `<div class="note">${cal ? `Confidence check — ${cal}. Honest calls: high-confidence ones should be right more often than low.<br>` : ''}How grading works: BUY/SELL = whichever trades first, stop or target (both inside one candle counts as a loss). Expired = marked at the last price, capped at the planned R. FLAT = right only if neither band edge was touched. Prices are on the TradeLocker scale at the time of the call. Every call is committed to <a href="https://github.com/zachpeterson2016-collab/gold-scanner/commits/main/predictions.json" target="_blank">GitHub</a> with a timestamp — it cannot be edited or backdated afterwards. Hover a row for the reasoning.</div></div>`;
  $('#tab-predict').innerHTML = html;
};
