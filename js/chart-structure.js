/* Structure overlays for the chart: trend-health ribbon, zigzag legs, HH/HL/LH/LL pills, forming swings, labelled key levels.
   Called from Chart.draw with an environment E = { ctx, c, X, Y, s0, s1, n, bw, left, xRight, top, bot, off, text, line }. */
const StructDraw = (() => {
  const RGBA = { grn: '38,166,154', red: '239,83,80', org: '255,159,67', gry: '138,147,163' };
  const ribbonCol = p => {
    if (!p || p.phase === 'NONE') return null;
    if (p.phase === 'RANGE') return `rgba(${RGBA.gry},.45)`;
    if (p.warn.length) return `rgba(${RGBA.org},.85)`;
    return `rgba(${p.trend === 'up' ? RGBA.grn : RGBA.red},${p.phase === 'SHIFT' ? .3 : .75})`;
  };
  function idxAt(c, t) { let lo = 0, hi = c.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }

  function pill(E, s, x, yBase, above, col, alpha, size = 11) {
    const { ctx } = E; ctx.font = `bold ${size}px system-ui, Segoe UI, sans-serif`;
    const w = ctx.measureText(s).width + 8, h = size + 5, y = above ? yBase - h : yBase;
    ctx.globalAlpha = alpha; ctx.fillStyle = `rgba(${col},.25)`; ctx.strokeStyle = `rgba(${col},.95)`; ctx.lineWidth = 1;
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x - w / 2, y, w, h, 4); else ctx.rect(x - w / 2, y, w, h); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(s, x, y + h - 4); ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }

  // rows: [{ name, colAt(i) → css color | null, ticks: [x...] }] — row 0 sits just above the time axis, row 1 above it
  function ribbon(E, rows) {
    const { ctx, X, bw, s0, s1, left, bot } = E;
    rows.forEach((row, r) => {
      const y = bot - 6 * (r + 1), h = 5;
      let runCol = null, runX = 0;
      const flush = xEnd => { if (runCol) { ctx.fillStyle = runCol; ctx.fillRect(runX, y, xEnd - runX, h); } };
      for (let i = s0; i < s1; i++) { const col = row.colAt(i), x = X(i) - bw / 2; if (col !== runCol) { flush(x); runCol = col; runX = x; } }
      flush(X(s1 - 1) + bw / 2);
      ctx.fillStyle = `rgba(${RGBA.org},1)`; for (const x of row.ticks || []) ctx.fillRect(x - 1, y - 1, 2, h + 2);
      ctx.fillStyle = 'rgba(11,14,19,.85)'; ctx.fillRect(left, y - 1, 24, h + 2);
      E.text(row.name, left + 2, y + h - 0.5, '#8a93a3', 9, 'bold');
    });
  }

  function zigzag(E, S, forming) {
    const { ctx, X, Y, s0, s1, bw } = E, zz = S.zz; if (bw < 1) return;   // multi-year view: the ribbon + key levels tell the story
    let k0 = zz.findIndex(s => s.i >= s0); if (k0 < 0) k0 = zz.length; k0 = Math.max(0, k0 - 1);
    ctx.lineWidth = 1.5; ctx.globalAlpha = .8;
    for (let k = k0; k + 1 < zz.length && zz[k].i <= s1; k++) { const a = zz[k], b = zz[k + 1]; ctx.strokeStyle = b.p > a.p ? '#26a69a' : '#ef5350'; E.line(X(a.i), Y(a.p), X(b.i), Y(b.p)); }
    ctx.globalAlpha = 1;
    for (const f of forming || []) {
      if (f.i < s0 || f.i >= s1) continue;
      const x = X(f.i), y = Y(f.p), isH = f.type === 'H';
      if (f.from) { ctx.strokeStyle = 'rgba(230,233,239,.55)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2; E.line(X(f.from.i), Y(f.from.p), x, y); ctx.setLineDash([]); }
      ctx.strokeStyle = '#e6e9ef'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 5, y); ctx.closePath(); ctx.stroke();
      if (bw >= 3.5) {
        pill(E, `${f.label}?`, x, isH ? y - 8 : y + 8, isH, RGBA.gry, 1);
        if (bw >= 6) { ctx.textAlign = 'center'; E.text(`forming · ${f.confirmIn} bar${f.confirmIn > 1 ? 's' : ''} to confirm`, x, isH ? y - 28 : y + 36, '#8a93a3', 10); ctx.textAlign = 'left'; }
      }
    }
  }

  function labels(E, S) {
    const { X, Y, s0, s1, c, bw } = E; if (bw < 3.5) return;
    const zz = S.zz, recent = bw < 7 ? zz.length - 8 : 0;   // zoomed out: only the recent structure + still-valid swings get a pill
    zz.forEach((s, k) => {
      if (s.i < s0 || s.i >= s1 || (k < recent && s.broken)) return;
      const bull = s.label === 'HH' || s.label === 'HL', col = s.label.length === 1 ? RGBA.gry : bull ? RGBA.grn : RGBA.red;
      pill(E, s.label, X(s.i), s.type === 'H' ? Y(c[s.i].h) - 6 : Y(c[s.i].l) + 6, s.type === 'H', col, s.broken ? .5 : 1);
    });
  }

  // The two levels that matter now: key (close-break = CHoCH) and far (close-break = BOS), worded for the current phase.
  function keyLevels(E, p) {
    if (!p || p.phase === 'NONE') return;
    const { ctx, X, Y, left, xRight, off, top } = E, px = v => (v + off).toFixed(1);
    const draw = (s, col, dash, label, above) => {
      if (!s) return; const xs = X(s.i), x0 = Math.max(left, xs), y = Y(s.p);
      ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash(dash); E.line(x0, y, xRight, y); ctx.setLineDash([]);
      E.text(label(s), xs < left ? left + 60 : x0 + 4, above ? y - 4 : y + 13, col, 11, 'bold');   // +60 clears the purple HTF label when the swing is off-screen left
    };
    const up = p.trend === 'up', grn = '#26a69a', red = '#ef5350', gry = 'rgba(230,233,239,.6)';
    if (p.phase === 'RANGE') {
      draw(up ? p.far : p.key, gry, [6, 4], s => `range top ${px(s.p)} · close above = up`, true);
      draw(up ? p.key : p.far, gry, [6, 4], s => `range bottom ${px(s.p)} · close below = down`, false);
      return;
    }
    if (p.phase === 'SHIFT') draw(p.key, up ? grn : red, [], s => `${up ? '▲ new uptrend' : '▼ new downtrend'} (unconfirmed) · close ${up ? 'below' : 'above'} ${px(s.p)} = fake-out`, !up);
    else draw(p.key, up ? grn : red, [], s => `${up ? '▲ uptrend holds above' : '▼ downtrend holds below'} ${px(s.p)} (${s.label}) · close ${up ? 'below' : 'above'} = CHoCH`, !up);
    draw(p.far, gry, [2, 4], s => `BOS ${up ? '↑ above' : '↓ below'} ${px(s.p)} (${s.label}) = ${p.phase === 'SHIFT' ? 'confirms the new trend' : 'continuation'}`, up);
    if (p.ext) E.text(`price is ${up ? 'above every confirmed high' : 'below every confirmed low'} — no BOS level until a new swing forms`, left + 4, top + 28, '#8a93a3', 11);
  }

  // D = { tf, gran, S, ph, forming, htf: { name, S, ph, gran } | null }
  function draw(E, D) {
    const S = D.S; if (!S || !D.ph || !D.ph.length) return;
    const { X, s0, s1, c } = E;
    const own = { name: D.tf === '15m' ? '15m' : D.tf === '1h' ? '1H' : 'D', colAt: i => ribbonCol(D.ph[Math.min(i, D.ph.length - 1)]), ticks: S.events.filter(e => e.type === 'CHoCH' && e.i >= s0 && e.i < s1).map(e => X(e.i)) };
    const rows = [own];
    if (D.htf && D.htf.ph && D.htf.ph.length) {
      const hc = D.htf.S.c, g = D.htf.gran, o = D.gran;
      const ticks = [];
      for (const e of D.htf.S.events) if (e.type === 'CHoCH') { const i = idxAt(c, hc[e.i].t + g - o); if (i >= s0 && i < s1 && c[i].t >= hc[e.i].t) ticks.push(X(i)); }
      rows.push({ name: D.htf.name, colAt: i => { const j = idxAt(hc, c[i].t + o - g); return j >= 0 ? ribbonCol(D.htf.ph[j]) : null; }, ticks });
    }
    ribbon(E, rows);
    zigzag(E, S, D.forming);
    labels(E, S);
    keyLevels(E, D.ph[D.ph.length - 1]);
  }
  return { draw, ribbonCol, idxAt };
})();
