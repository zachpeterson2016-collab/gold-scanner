/* Canvas chart: candles + structure overlays, pan/zoom, crosshair. Prices are PAXG internally; the axis/hover add `offset` to show spot-equivalent. */
const Chart = (() => {
  const C = { bg: '#0b0e13', grid: '#161c24', txt: '#8a93a3', up: '#26a69a', dn: '#ef5350', gold: '#f5c542', blu: '#4f8ef7', org: '#ff9f43', pur: '#b388ff', red: '#ef5350', grn: '#26a69a' };
  let cv, ctx, hoverEl, dpr = 1, W = 0, H = 0, onView = null, sb = null;
  const PAD = { l: 8, r: 72, t: 10, b: 26 };
  let D = { tf: '15m', c: [], S: null, offset: 0, setups: [], ov: {}, htf: null, fc: null, scen: null, preds: [], focus: null, ph: null, forming: [], gran: 900000, news: [] }, view = { start: 0, count: 160 }, follow = true, mouse = null, drag = null, fut = 0;
  function idxAt(c, t) { let lo = 0, hi = c.length - 1, r = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (c[m].t <= t) { r = m; lo = m + 1; } else hi = m - 1; } return r; }

  function init(canvas, hover, scroll) {
    cv = canvas; ctx = cv.getContext('2d'); hoverEl = hover;
    new ResizeObserver(resize).observe(cv.parentElement);
    resize();
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      // Shift+wheel or a sideways trackpad swipe scrolls through time; plain wheel zooms
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { pan((e.shiftKey ? (e.deltaY || e.deltaX) : e.deltaX) > 0 ? 0.2 : -0.2); return; }
      const f = e.deltaY > 0 ? 1.15 : 1 / 1.15; zoomAt(f, e.offsetX);
    }, { passive: false });
    cv.addEventListener('mousedown', e => { drag = { x: e.offsetX, start: view.start }; });
    window.addEventListener('mouseup', () => { drag = null; });
    cv.addEventListener('mousemove', e => {
      mouse = { x: e.offsetX, y: e.offsetY };
      if (drag) { const bw = plotW() / view.count; const dx = Math.round((drag.x - e.offsetX) / bw); const was = view.start; setStart(drag.start + dx); if (view.start !== was) userMoved(); }
      draw();
    });
    cv.addEventListener('mouseleave', () => { mouse = null; hoverEl.textContent = ''; draw(); });
    cv.addEventListener('dblclick', () => { toEnd(); });
    if (scroll) initScroll(scroll);
  }
  // Scrollbar under the time axis. Pointer events so it works with a finger on the phone too.
  function initScroll(el) {
    const track = el.querySelector('.track'), thumb = el.querySelector('.thumb');
    sb = { track, thumb, key: '' };
    let grab = null;
    const span = () => Math.max(1, track.clientWidth - thumb.offsetWidth); // pixels the thumb can travel
    track.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (e.target !== thumb) { // click on the track: jump so the thumb centres on the pointer, then keep dragging from there
        const x = e.clientX - track.getBoundingClientRect().left;
        const was = view.start; setStart(Math.round((x - thumb.offsetWidth / 2) / span() * maxStart()));
        if (view.start !== was) { userMoved(); draw(); }
      }
      grab = { x0: e.clientX, start0: view.start, sp: span() };
      track.classList.add('drag'); track.setPointerCapture(e.pointerId);
    });
    track.addEventListener('pointermove', e => {
      if (!grab) return;
      const was = view.start; setStart(Math.round(grab.start0 + (e.clientX - grab.x0) / grab.sp * maxStart()));
      if (view.start !== was) { userMoved(); draw(); }
    });
    const end = () => { grab = null; track.classList.remove('drag'); };
    track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
    track.addEventListener('wheel', e => { e.preventDefault(); pan((e.deltaY || e.deltaX) > 0 ? 0.2 : -0.2); }, { passive: false });
    el.querySelectorAll('.hs').forEach(b => b.addEventListener('click', () => pan(0.5 * +b.dataset.dir)));
  }
  function syncScroll() {
    if (!sb) return;
    const total = D.c.length + fut, tw = sb.track.clientWidth;
    let w = tw, left = 0;
    if (total && tw) { w = Math.max(24, Math.min(tw, tw * Math.min(view.count, total) / total)); const ms = maxStart(); left = ms ? (tw - w) * (view.start / ms) : 0; }
    const key = Math.round(left) + '/' + Math.round(w);
    if (key !== sb.key) { sb.key = key; sb.thumb.style.width = Math.round(w) + 'px'; sb.thumb.style.left = Math.round(left) + 'px'; }
  }
  function resize() {
    const r = cv.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    W = Math.max(50, r.width); H = Math.max(50, r.height);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    draw();
  }
  const plotW = () => W - PAD.l - PAD.r, plotH = () => H - PAD.t - PAD.b;
  // `fut` = empty slots kept to the right of the last candle so the forecast cone has room
  const maxStart = () => { const n = D.c.length + fut; return Math.max(0, n - Math.min(view.count, n)); };
  function setStart(s) { view.start = Math.max(0, Math.min(s, maxStart())); follow = view.start + view.count >= D.c.length + fut; }
  function focus(i) { follow = false; setStart(Math.round(i - view.count * 0.5)); draw(); }
  const maxCount = () => Math.max(2000, D.c.length + fut);
  function userMoved() { if (onView) onView(); }
  function zoomAt(f, x) {
    const n = D.c.length; const bw = plotW() / view.count; const idx = view.start + (x - PAD.l) / bw;
    view.count = Math.max(30, Math.min(maxCount(), Math.round(view.count * f)));
    setStart(Math.round(idx - (x - PAD.l) / (plotW() / view.count)));
    userMoved();
    draw();
  }
  function zoom(f) { zoomAt(f, PAD.l + plotW() * 0.5); }
  // move by a fraction of the visible window (negative = back in time)
  function pan(frac) { const was = view.start; setStart(view.start + Math.round(view.count * frac)); if (view.start !== was) { userMoved(); draw(); } }
  function toStart() { setStart(0); draw(); }
  function toEnd() { follow = true; setStart(maxStart()); draw(); }
  // Show the most recent `bars` candles (plus the forecast slots), e.g. for the 1D … 5Y range buttons.
  function showLast(bars) { view.count = Math.max(30, Math.min(maxCount(), Math.round(bars + fut))); toEnd(); }
  function setData(d) {
    Object.assign(D, d);
    const n = D.c.length;
    fut = (D.ov.forecast && D.fc && n) ? Math.max(0, D.fc.H - (n - 1 - idxAt(D.c, D.fc.t))) : 0;
    if (follow) view.start = maxStart();
    draw();
  }

  function draw() {
    if (!ctx) return;
    syncScroll();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const c = D.c, n = c.length; if (!n) { text('loading candles…', W / 2 - 50, H / 2, C.txt); return; }
    const s0 = view.start, s1 = Math.min(n, s0 + view.count), off = D.offset || 0;
    let lo = Infinity, hi = -Infinity;
    for (let i = s0; i < s1; i++) { lo = Math.min(lo, c[i].l); hi = Math.max(hi, c[i].h); }
    for (const st of D.setups || []) if (st.levels && st.levels.entry !== undefined && D.ov.setup) { lo = Math.min(lo, st.levels.stop); hi = Math.max(hi, st.levels.tp); }
    const fcOn = D.ov.forecast && D.fc, fi0 = fcOn ? idxAt(c, D.fc.t) : -1, sEnd = s0 + view.count;
    if (fcOn && fi0 >= 0) {
      for (let h = 1; h <= D.fc.H; h++) if (fi0 + h >= s0 && fi0 + h < sEnd) { lo = Math.min(lo, D.fc.q10[h - 1]); hi = Math.max(hi, D.fc.q90[h - 1]); }
      if (D.scen && n - 1 < sEnd) { lo = Math.min(lo, D.scen.target, D.scen.bust); hi = Math.max(hi, D.scen.target, D.scen.bust); }
    }
    if (!isFinite(lo) || !isFinite(hi)) { lo = c[n - 1].l; hi = c[n - 1].h; }
    const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad;
    const bw = plotW() / view.count, body = Math.max(1, Math.min(bw * 0.7, 14));
    const lineMode = bw < 1.6, dense = bw < 3; // zoomed far out: close line instead of candles, fewer labels
    const X = i => PAD.l + (i - s0 + 0.5) * bw, Y = p => PAD.t + (hi - p) / (hi - lo) * plotH();
    const xRight = PAD.l + plotW();
    ctx.save(); ctx.beginPath(); ctx.rect(PAD.l, PAD.t, plotW(), plotH()); ctx.clip();

    if (D.ov.sessions && D.tf !== '1d' && !dense) for (let i = s0; i < s1; i++) { const s = Data.session(c[i].t); if (s.kz) { ctx.fillStyle = s.name[0] === 'L' ? 'rgba(79,142,247,.07)' : 'rgba(245,197,66,.07)'; ctx.fillRect(X(i) - bw / 2, PAD.t, bw + 0.5, plotH()); } }
    // grid
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    const step = niceStep((hi - lo) / 6);
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) { line(PAD.l, Y(p), xRight, Y(p)); }
    // candles (or a close line when there is less than ~1.6 px per bar)
    if (lineMode) {
      const base = PAD.t + plotH();
      ctx.beginPath(); ctx.moveTo(X(s0), base); for (let i = s0; i < s1; i++) ctx.lineTo(X(i), Y(c[i].c)); ctx.lineTo(X(s1 - 1), base); ctx.closePath();
      const g = ctx.createLinearGradient(0, PAD.t, 0, base); g.addColorStop(0, 'rgba(245,197,66,.22)'); g.addColorStop(1, 'rgba(245,197,66,0)'); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = C.gold; ctx.lineWidth = 1.4; ctx.beginPath(); for (let i = s0; i < s1; i++) i === s0 ? ctx.moveTo(X(i), Y(c[i].c)) : ctx.lineTo(X(i), Y(c[i].c)); ctx.stroke(); ctx.lineWidth = 1;
    } else for (let i = s0; i < s1; i++) {
      const b = c[i], up = b.c >= b.o, col = up ? C.up : C.dn, x = X(i);
      ctx.strokeStyle = col; ctx.fillStyle = col;
      line(x, Y(b.h), x, Y(b.l));
      const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c));
      ctx.fillRect(x - body / 2, y1, body, Math.max(1, y2 - y1));
    }
    const S = D.S;
    if (S) {
      if (D.ov.liq) {
        for (const e of (dense ? S.eq.slice(-4) : S.eq)) { if (e.from > s1) continue; ctx.setLineDash([6, 4]); ctx.strokeStyle = C.gold; ctx.lineWidth = 1.2; line(Math.max(PAD.l, X(e.from)), Y(e.level), xRight, Y(e.level)); ctx.setLineDash([]); text(`${e.type === 'H' ? 'EQH' : 'EQL'} ×${e.count}${e.swept ? ' (swept)' : ''}`, xRight - 92, Y(e.level) + (e.type === 'H' ? -4 : 12), C.gold, 11); }
        if (!dense) for (const sw of S.sweeps) { if (sw.i < s0 || sw.i >= s1) continue; text('$', X(sw.i) - 3, sw.dir === 'high' ? Y(c[sw.i].h) - 6 : Y(c[sw.i].l) + 14, C.gold, 12, 'bold'); }
      }
      if (D.ov.events) for (const e of (lineMode ? S.events.slice(-4) : dense ? S.events.slice(-8) : S.events)) {
        if (e.i < s0 - 300 || e.i >= s1) continue;
        const x0 = Math.max(PAD.l, X(e.swing.i)), x1 = X(e.i), y = Y(e.level), fake = e.outcome === 'fake', col = e.type === 'CHoCH' ? (fake ? 'rgba(255,159,67,.55)' : C.org) : C.blu;
        ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]); line(x0, y, x1, y); ctx.setLineDash([]);
        text(e.type + (fake ? ' ✗' : ''), x1 - 14, e.dir === 'up' ? y - 5 : y + 13, col, 11, 'bold');
      }
      if (D.ov.swings) StructDraw.draw({ ctx, c, X, Y, s0, s1, n, bw, left: PAD.l, xRight, top: PAD.t, bot: PAD.t + plotH(), off, text, line }, { tf: D.tf, gran: D.gran, S, ph: D.ph, forming: D.forming, htf: D.htf });
    }
    if (D.ov.htf && D.htf && D.htf.S && D.tf !== '1d') {
      const Hh = D.htf.S;
      for (const s of [Hh.lastH, Hh.lastL]) if (s && !s.broken) { ctx.strokeStyle = C.pur; ctx.lineWidth = 1.5; ctx.setLineDash([8, 4]); line(PAD.l, Y(s.p), xRight, Y(s.p)); ctx.setLineDash([]); text(`${D.htf.name} ${s.label}`, PAD.l + 4, Y(s.p) - 4, C.pur, 11, 'bold'); }
    }
    if (D.ov.setup) for (const st of D.setups || []) {
      const L = st.levels; if (!L) continue;
      const long = st.side === 'long';
      if (L.leg && D.tf === '15m' && (st.status === 'TREND' || st.status === 'WATCHING' || st.status === 'WAITING' || st.status === 'TRIGGERED' || st.status === 'ACTIVE')) {
        const zTop = long ? L.ext - L.leg * 0.382 : L.ext + L.leg * 0.382, zBot = long ? Math.max(L.anchor, L.ext - L.leg * 0.79) : Math.min(L.anchor, L.ext + L.leg * 0.79);
        ctx.fillStyle = long ? 'rgba(38,166,154,.10)' : 'rgba(239,83,80,.10)';
        const x0 = Math.max(PAD.l, X(L.extIdx)); ctx.fillRect(x0, Y(Math.max(zTop, zBot)), xRight - x0, Math.abs(Y(zTop) - Y(zBot)));
        text(`${long ? 'buy' : 'sell'} zone 38–79%`, x0 + 4, Y(Math.max(zTop, zBot)) + 12, long ? C.grn : C.red, 11);
      }
      if (L.entry !== undefined && D.tf === '15m') {
        const x0 = Math.max(PAD.l, X(L.evI)), w = xRight - x0;
        ctx.fillStyle = 'rgba(239,83,80,.18)'; ctx.fillRect(x0, Y(Math.max(L.entry, L.stop)), w, Math.abs(Y(L.entry) - Y(L.stop)));
        ctx.fillStyle = 'rgba(38,166,154,.18)'; ctx.fillRect(x0, Y(Math.max(L.entry, L.tp)), w, Math.abs(Y(L.entry) - Y(L.tp)));
        ctx.strokeStyle = C.txt; ctx.setLineDash([4, 3]); line(x0, Y(L.entry), xRight, Y(L.entry)); ctx.setLineDash([]);
        text(`entry ${(L.entry + off).toFixed(1)}`, x0 + 4, Y(L.entry) - 3, '#e6e9ef', 11);
        text(`SL ${(L.stop + off).toFixed(1)}`, x0 + 4, long ? Y(L.stop) + 12 : Y(L.stop) - 3, C.red, 11);
        text(`TP ${(L.tp + off).toFixed(1)} (${L.R.toFixed(1)}R)`, x0 + 4, long ? Y(L.tp) - 3 : Y(L.tp) + 12, C.grn, 11);
      }
    }
    // forecast: future area, pattern cone, structure route, ghosts of earlier predictions
    if (D.ov.forecast) {
      const f = D.fc;
      if (fut) {
        const xNow = X(n - 1) + bw / 2;
        ctx.fillStyle = 'rgba(245,197,66,.035)'; ctx.fillRect(xNow, PAD.t, xRight - xNow, plotH());
        ctx.strokeStyle = 'rgba(245,197,66,.4)'; ctx.setLineDash([2, 3]); line(xNow, PAD.t, xNow, PAD.t + plotH()); ctx.setLineDash([]);
        text('now ▸ forecast', xNow + 4, PAD.t + plotH() - 18, C.gold, 11);
      }
      const PL = D.preds || [];
      for (const p of PL.slice(-14)) {
        if (f && p.t === f.t) continue;
        const i0 = idxAt(c, p.t); if (i0 < 0 || c[i0].t !== p.t || i0 + p.H < s0 || i0 > sEnd) continue;
        const isF = p.id === D.focus, h = Math.max(1, Math.min(p.n || p.H, p.H));
        const col = p.status !== 'done' ? 'rgba(245,197,66,.85)' : p.mae < p.maeFlat ? 'rgba(38,166,154,.9)' : 'rgba(239,83,80,.85)';
        if (isF) { ctx.beginPath(); ctx.moveTo(X(i0), Y(p.c0)); for (let k = 1; k <= p.H; k++) ctx.lineTo(X(i0 + k), Y(p.q25[k - 1])); for (let k = p.H; k >= 1; k--) ctx.lineTo(X(i0 + k), Y(p.q75[k - 1])); ctx.closePath(); ctx.fillStyle = 'rgba(179,136,255,.14)'; ctx.fill(); }
        ctx.strokeStyle = isF ? C.pur : col; ctx.lineWidth = isF ? 2.2 : 1.2; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(X(i0), Y(p.c0)); for (let k = 1; k <= p.H; k++) ctx.lineTo(X(i0 + k), Y(p.med[k - 1])); ctx.stroke(); ctx.setLineDash([]);
        text('◆', X(i0) - 4, Y(p.c0) + 4, isF ? C.pur : col, 10);
        if (isF || p === PL[PL.length - 1]) text(`${p.status === 'done' ? (p.mae < p.maeFlat ? '✓' : '✗') : '…'}${p.err !== undefined ? ` ${p.err >= 0 ? '+' : '−'}$${Math.abs(p.err).toFixed(1)}` : ''}`, X(i0 + h) + 4, Y(p.med[h - 1]) + 4, isF ? C.pur : col, 11, 'bold');
      }
      if (f && fi0 >= 0) {
        const xs = h => X(fi0 + h);
        const band = (a, b, col) => { ctx.beginPath(); ctx.moveTo(X(fi0), Y(f.c0)); for (let h = 1; h <= f.H; h++) ctx.lineTo(xs(h), Y(a[h - 1])); for (let h = f.H; h >= 1; h--) ctx.lineTo(xs(h), Y(b[h - 1])); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); };
        band(f.q10, f.q90, 'rgba(245,197,66,.08)'); band(f.q25, f.q75, 'rgba(245,197,66,.15)');
        ctx.strokeStyle = C.gold; ctx.lineWidth = 1.8; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(X(fi0), Y(f.c0)); for (let h = 1; h <= f.H; h++) ctx.lineTo(xs(h), Y(f.med[h - 1])); ctx.stroke(); ctx.setLineDash([]);
        const e = f.med[f.H - 1];
        ctx.textAlign = 'right'; text(`${f.H} bars → ${(e + off).toFixed(1)} · 50% ${(f.q25[f.H - 1] + off).toFixed(0)}–${(f.q75[f.H - 1] + off).toFixed(0)} · ${Math.round(f.pUp * 100)}% ↑`, xRight - 6, PAD.t + 14, C.gold, 11, 'bold'); ctx.textAlign = 'left';
      }
      if (D.scen && f && fi0 >= 0) {
        const sc = D.scen, long = sc.side === 'long', col = long ? C.grn : C.red, xNow = X(n - 1) + bw / 2, od = sc.odds;
        ctx.setLineDash([6, 4]); ctx.lineWidth = 1.4;
        ctx.strokeStyle = C.grn; line(xNow, Y(sc.target), xRight, Y(sc.target));
        ctx.strokeStyle = C.red; line(xNow, Y(sc.bust), xRight, Y(sc.bust)); ctx.setLineDash([]);
        ctx.textAlign = 'right';
        text(`🎯 ${(sc.target + off).toFixed(1)}${od && od.n ? ' · ' + Math.round(od.target * 100) + '% hit' : ''}`, xRight - 4, Y(sc.target) + (long ? -4 : 13), C.grn, 11, 'bold');
        text(`✗ bust ${(sc.bust + off).toFixed(1)}${od && od.n ? ' · ' + Math.round(od.bust * 100) + '%' : ''}`, xRight - 4, Y(sc.bust) + (long ? 13 : -4), C.red, 11, 'bold');
        ctx.textAlign = 'left';
        const pts = [[fi0, sc.c0]]; if (sc.needZone) pts.push([fi0 + f.H * 0.45, (sc.zone[0] + sc.zone[1]) / 2]); pts.push([fi0 + f.H, sc.target]);
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash([3, 3]); ctx.beginPath(); pts.forEach((p, k) => k ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))); ctx.stroke(); ctx.setLineDash([]);
        const a = pts[pts.length - 2], b = pts[pts.length - 1], ang = Math.atan2(Y(b[1]) - Y(a[1]), X(b[0]) - X(a[0]));
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(X(b[0]), Y(b[1])); ctx.lineTo(X(b[0]) - 9 * Math.cos(ang - 0.4), Y(b[1]) - 9 * Math.sin(ang - 0.4)); ctx.lineTo(X(b[0]) - 9 * Math.cos(ang + 0.4), Y(b[1]) - 9 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
      }
    }
    // scheduled news: shaded no-trade window + dashed line + label (15m / 1H, hidden when zoomed far out)
    if (D.news && D.news.length && D.tf !== '1d' && !dense) {
      const lastT = c[n - 1].t, xAt = t => { const i = t <= lastT ? idxAt(c, t) : n - 1; return i < 0 ? -1e9 : X(i) - bw / 2 + Math.min((t - c[i].t) / D.gran, i === n - 1 ? 1e9 : 1) * bw; };
      let lx = -1e9, ly = PAD.t + 26;
      for (const e of D.news) {
        const x0 = xAt(e.t - e.before), x1 = xAt(e.t + e.after), xe = xAt(e.t); if (x1 < PAD.l || x0 > xRight) continue;
        const red = e.impact === 'red', col = red ? C.red : C.org;
        ctx.fillStyle = red ? 'rgba(239,83,80,.12)' : 'rgba(255,159,67,.10)'; ctx.fillRect(Math.max(PAD.l, x0), PAD.t, Math.min(xRight, x1) - Math.max(PAD.l, x0), plotH());
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([2, 4]); line(xe, PAD.t, xe, PAD.t + plotH()); ctx.setLineDash([]);
        ly = xe - lx < 150 ? ly + 13 : PAD.t + 26; lx = xe;
        const right = xe > xRight - 150; ctx.textAlign = right ? 'right' : 'left';
        text(`${red ? '🔴' : '🟠'} ${e.name} ${News.fmtHM(e.t)}`, right ? xe - 4 : xe + 4, ly, col, 11, 'bold'); ctx.textAlign = 'left';
      }
    }
    // crosshair
    if (mouse && mouse.x > PAD.l && mouse.x < xRight && mouse.y > PAD.t && mouse.y < PAD.t + plotH()) {
      const ii = s0 + Math.floor((mouse.x - PAD.l) / bw), i = Math.min(n - 1, Math.max(0, ii));
      const fh = (fcOn && fi0 >= 0 && ii > n - 1) ? ii - fi0 : 0, xi = fh ? X(ii) : X(i);
      ctx.strokeStyle = 'rgba(230,233,239,.25)'; ctx.setLineDash([3, 3]); line(xi, PAD.t, xi, PAD.t + plotH()); line(PAD.l, mouse.y, xRight, mouse.y); ctx.setLineDash([]);
      const p = hi - (mouse.y - PAD.t) / plotH() * (hi - lo);
      ctx.fillStyle = '#1b2a3d'; ctx.fillRect(xRight + 2, mouse.y - 9, PAD.r - 4, 18); text((p + off).toFixed(1), xRight + 8, mouse.y + 4, '#dbe8ff', 11);
      if (fh && fh <= D.fc.H) {
        const f = D.fc, k = fh - 1;
        hoverEl.textContent = `forecast +${fh} bar${fh > 1 ? 's' : ''} · median ${(f.med[k] + off).toFixed(1)} · 50% band ${(f.q25[k] + off).toFixed(1)}–${(f.q75[k] + off).toFixed(1)} · 80% band ${(f.q10[k] + off).toFixed(1)}–${(f.q90[k] + off).toFixed(1)}`;
      } else {
        const b = c[i], se = Data.session(b.t), pp = D.ph && D.ph.length ? D.ph[Math.min(i, D.ph.length - 1)] : null;
        hoverEl.textContent = `${Data.fmtTime(b.t)} CT · O ${(b.o + off).toFixed(1)}  H ${(b.h + off).toFixed(1)}  L ${(b.l + off).toFixed(1)}  C ${(b.c + off).toFixed(1)} · ${se.name}${pp && pp.trend ? ` · ${pp.trend === 'up' ? '▲ up' : '▼ down'} · ${Structure.phaseLabel(pp).short}` : ''}`;
      }
    }
    ctx.restore();
    // axes
    ctx.fillStyle = C.bg; ctx.fillRect(xRight, 0, PAD.r, H);
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) text((p + off).toFixed(step < 1 ? 1 : 0), xRight + 6, Y(p) + 4, C.txt, 11);
    const last = c[n - 1]; const ly = Y(last.c);
    if (ly > PAD.t && ly < PAD.t + plotH()) { ctx.fillStyle = last.c >= last.o ? C.up : C.dn; ctx.fillRect(xRight + 2, ly - 9, PAD.r - 4, 18); text((last.c + off).toFixed(1), xRight + 8, ly + 4, '#fff', 11, 'bold'); }
    const every = Math.max(1, Math.round(view.count / 8)), monthly = D.tf === '1d' && (c[s1 - 1].t - c[s0].t) > 200 * 86400000;
    for (let i = s0; i < s1; i++) if ((i - s0) % every === 0) text(monthly ? Data.fmtMonthYear(c[i].t) : D.tf === '1d' ? Data.fmtDay(c[i].t) : Data.fmtTime(c[i].t).replace(/^\w+ \d+, /, ''), X(i) - 20, H - 8, C.txt, 11);
    // period separators for 15m: day labels
    if (D.tf !== '1d') for (let i = Math.max(s0, 1); i < s1; i++) { const a = Data.ctParts(c[i - 1].t), b = Data.ctParts(c[i].t); if (a.wd !== b.wd) { ctx.strokeStyle = 'rgba(138,147,163,.25)'; line(X(i) - bw / 2, PAD.t, X(i) - bw / 2, PAD.t + plotH()); text(Data.fmtDay(c[i].t), X(i) - bw / 2 + 3, PAD.t + 12, C.txt, 11); } }
  }
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; }
  function line(x0, y0, x1, y1) { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); }
  function text(s, x, y, col, size = 12, weight = 'normal') { ctx.fillStyle = col; ctx.font = `${weight} ${size}px system-ui, Segoe UI, sans-serif`; ctx.fillText(s, x, y); }
  return { init, setData, draw, zoom, pan, toStart, toEnd, focus, showLast, onUserView: cb => { onView = cb; }, get view() { return view; }, get state() { return { start: view.start, count: view.count, follow, fut, n: D.c.length, W, H, maxStart: maxStart(), bw: plotW() / view.count }; } };
})();
