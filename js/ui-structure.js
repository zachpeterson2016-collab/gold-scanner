/* Structure tab, beginner-friendly: a "Right now" verdict, then one card per timeframe (Daily → 1H → 15m) with a
   mini zigzag diagram, a 3-row level ladder, short plain-English bullets, and collapsed odds / recent events. */
UI.structure = function (m) {
  const $ = UI.$, off = m.off || 0, root = $('#tab-structure');
  const px = v => (v + off).toFixed(1);
  const NAME = { '15m': '15-minute', '1h': '1-hour', '1d': 'Daily' }, SHORT = { '15m': '15m', '1h': '1H', '1d': 'Daily' };
  const CLOSE = { '15m': '15m close', '1h': '1H close', '1d': 'daily close' };
  const bars = (k, b) => b == null ? '' : k === '15m' ? `${b} bars (~${(b / 4).toFixed(b % 4 ? 1 : 0)} h)` : k === '1h' ? `${b} h` : `${b} days`;
  const pct = (a, n) => n ? Math.round(a / n * 100) + '%' : '—';
  const last = k => { const a = m.ph[k]; return a && a.length ? a[a.length - 1] : null; };
  const WARN_TXT = {
    up: { failed: 'The last swing high is <b>lower</b> than the one before (LH) — buyers failed to push higher', deep: 'The last swing low dipped <b>under</b> the previous low by wick, with no close below (LL) — stops under the HL were taken', sweep: 'The key higher-low was <b>wicked through</b> but the candle closed back above (sweep)' },
    down: { failed: 'The last swing low is <b>higher</b> than the one before (HL) — sellers failed to push lower', deep: 'The last swing high poked <b>over</b> the previous high by wick, with no close above (HH) — stops over the LH were taken', sweep: 'The key lower-high was <b>wicked through</b> but the candle closed back below (sweep)' }
  };

  // One badge per timeframe: icon + direction + one health word.
  function badge(p) {
    if (!p || p.phase === 'NONE') return { cls: 'ph-range', icon: '…', txt: '… no structure yet', word: 'no data', sub: '' };
    const up = p.trend === 'up', dir = up ? 'UP' : 'DOWN';
    if (p.phase === 'RANGE') return { cls: 'ph-range', icon: '◆', txt: '◆ CHOP', word: 'chop', sub: 'no clean trend — price keeps flipping without follow-through' };
    if (p.phase === 'SHIFT') return { cls: 'ph-shift', icon: '⏳', txt: `⏳ ${dir} · shifting`, word: 'shifting', sub: `just flipped ${up ? 'up' : 'down'} (CHoCH) — not confirmed yet` };
    if (p.warn.length) return { cls: 'ph-warn', icon: '⚠', txt: `⚠ ${dir} · warning`, word: 'warning', sub: p.warn.map(w => Structure.WARN[p.trend][w]).join(' + ') };
    return { cls: up ? 'ph-up' : 'ph-down', icon: up ? '▲' : '▼', txt: `${up ? '▲' : '▼'} ${dir} · healthy`, word: 'healthy', sub: up ? 'higher highs & higher lows, in order' : 'lower highs & lower lows, in order' };
  }

  // Mini diagram: last 6 confirmed swings as a zigzag, forming swing dashed, the two levels that matter, and "now".
  function mini(k, S, p, frm, price) {
    const zz = S.zz.slice(-6); if (zz.length < 2) return '';
    const fm = (frm || []).filter(f => f.from && zz.includes(f.from)), ext = fm.find(f => !f.replaces);
    const W = 360, H = 150, L = 10, R = 72, T = 28, B = 28, cols = zz.length + (ext ? 1 : 0) + 1;
    const xs = i => (L + i * (W - L - R) / (cols - 1)).toFixed(1);
    const vals = zz.map(s => s.p).concat(fm.map(f => f.p), [price], p.key ? [p.key.p] : [], p.far ? [p.far.p] : []);
    let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo || 1) * .08; lo -= pad; hi += pad;
    const Y = v => (T + (hi - v) / (hi - lo) * (H - T - B)).toFixed(1);
    const up = p.trend === 'up', trendCol = up ? '#26a69a' : '#ef5350';
    const lvl = (s, col, dash) => s ? `<line x1="${L}" x2="${W - 4}" y1="${Y(s.p)}" y2="${Y(s.p)}" stroke="${col}" stroke-width="1.3"${dash ? ` stroke-dasharray="${dash}"` : ''}/>` : '';
    let g = p.phase === 'RANGE' ? lvl(p.key, '#8a93a3', '5 4') + lvl(p.far, '#8a93a3', '5 4') : lvl(p.key, trendCol, '') + lvl(p.far, 'rgba(230,233,239,.55)', '2 4');
    for (let i = 1; i < zz.length; i++) g += `<line x1="${xs(i - 1)}" y1="${Y(zz[i - 1].p)}" x2="${xs(i)}" y2="${Y(zz[i].p)}" stroke="${zz[i].p > zz[i - 1].p ? '#26a69a' : '#ef5350'}" stroke-width="2"/>`;
    zz.forEach((s, i) => {
      const bull = s.label === 'HH' || s.label === 'HL', col = s.label.length === 1 ? '#8a93a3' : bull ? '#26a69a' : '#ef5350', y = +Y(s.p), x = xs(i), hiSide = s.type === 'H', op = s.broken ? .45 : 1;
      g += `<circle cx="${x}" cy="${y}" r="3.2" fill="${col}" opacity="${op}"/><text x="${x}" y="${hiSide ? y - 7 : y + 14}" text-anchor="middle" font-size="10.5" font-weight="800" fill="${col}" opacity="${op}">${s.label}</text><text x="${x}" y="${hiSide ? y - 17 : y + 24}" text-anchor="middle" font-size="9" fill="#8a93a3">${px(s.p)}</text>`;
    });
    for (const f of fm) {
      const x = f.replaces ? (+xs(zz.length - 1) + 14).toFixed(1) : xs(zz.length), y = +Y(f.p);
      g += `<line x1="${xs(zz.indexOf(f.from))}" y1="${Y(f.from.p)}" x2="${x}" y2="${y}" stroke="#e6e9ef" stroke-opacity=".55" stroke-dasharray="3 3" stroke-width="1.4"/><circle cx="${x}" cy="${y}" r="3.6" fill="#0d1117" stroke="#e6e9ef" stroke-width="1.3"/><text x="${x}" y="${f.type === 'H' ? y - 7 : y + 14}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#aab3c2">${f.label}?</text>`;
    }
    const lx = ext ? xs(zz.length) : xs(zz.length - 1), ly = Y(ext ? ext.p : zz[zz.length - 1].p), xNow = xs(cols - 1), yNow = Y(price);
    g += `<line x1="${lx}" y1="${ly}" x2="${xNow}" y2="${yNow}" stroke="#8a93a3" stroke-dasharray="2 3"/><circle cx="${xNow}" cy="${yNow}" r="4" fill="#f5c542"/><text x="${+xNow + 7}" y="${+yNow + 4}" font-size="10" font-weight="800" fill="#f5c542">now ${px(price)}</text>`;
    return `<svg class="mini" viewBox="0 0 ${W} ${H}" font-family="system-ui, Segoe UI, sans-serif">${g}</svg>`;
  }

  // Level ladder: what is above price, price itself, what is below — and what a close beyond each means.
  function ladder(k, p, price, atr) {
    if (!p || p.phase === 'NONE') return '';
    const up = p.trend === 'up', rows = [];
    const meaning = (isKey, above) => {
      const dir = above ? 'above' : 'below';
      if (p.phase === 'RANGE') return `close ${dir} → ${above ? 'UP' : 'DOWN'}`;
      if (p.phase === 'SHIFT') return isKey ? `close ${dir} = fake-out, back to ${up ? 'down' : 'up'}` : `close ${dir} = BOS, confirms the new ${up ? 'up' : 'down'}trend`;
      return isKey ? `close ${dir} = CHoCH, ${up ? 'up' : 'down'}trend ends` : `close ${dir} = BOS, ${up ? 'up' : 'down'}trend continues`;
    };
    const row = (s, isKey) => {
      const above = s.p >= price, d = Math.abs(s.p - price), ln = p.phase === 'RANGE' ? 'rng' : isKey ? (up ? 'hold-up' : 'hold-dn') : 'bos';
      return { p: s.p, html: `<div class="lrow"><i class="ln ${ln}"></i><b>${above ? '▲' : '▼'} ${px(s.p)}</b><span>${meaning(isKey, above)}</span><small>$${d.toFixed(1)} · ${(d / atr).toFixed(1)} ATR</small></div>` };
    };
    if (p.key) rows.push(row(p.key, true));
    if (p.far) rows.push(row(p.far, false));
    if (!p.far && p.ext) rows.push({ p: up ? Infinity : -Infinity, html: `<div class="lrow mut"><i class="ln"></i><b>${up ? '▲' : '▼'} —</b><span>no level ${up ? 'above' : 'below'} — price is past every confirmed ${up ? 'high' : 'low'}</span><small></small></div>` });
    rows.push({ p: price, html: `<div class="lrow now"><i class="ln now"></i><b>● ${px(price)}</b><span>price now (last ${CLOSE[k]})</span><small>1 ATR ≈ $${atr.toFixed(1)}</small></div>` });
    rows.sort((a, b) => b.p - a.p);
    return `<div class="ladder">${rows.map(r => r.html).join('')}</div>`;
  }

  function bullets(k, p, st) {
    if (!p || p.phase === 'NONE') return ['Not enough swings yet to call a trend.'];
    const up = p.trend === 'up', dirW = up ? 'uptrend' : 'downtrend', cl = CLOSE[k], out = [];
    const K = p.key ? `<b>${px(p.key.p)}</b>` : `the next swing ${up ? 'low' : 'high'}`, F = p.far ? `<b>${px(p.far.p)}</b>` : `the next swing ${up ? 'high' : 'low'}`;
    if (p.phase === 'RANGE') {
      const top = up ? p.far : p.key, bot = up ? p.key : p.far;
      out.push('🔀 Direction flipped at least twice recently with no follow-through — this is <b>chop</b>.');
      out.push('🤷 The HH / HL / LH / LL labels mean very little right now.');
      out.push(`⏸ Wait for a ${cl} ${top ? `above <b>${px(top.p)}</b> (→ up)` : 'above the range'} or ${bot ? `below <b>${px(bot.p)}</b> (→ down)` : 'below the range'}, then a BOS to confirm it.`);
      return out;
    }
    if (p.phase === 'SHIFT') {
      const when = p.ev ? Data.fmtTime(m.closed[k][p.ev.i].t) + ' CT' : 'recently';
      out.push(`🔁 Price closed ${up ? 'above the last lower high' : 'below the last higher low'} at ${when} — a <b>change of character</b> (CHoCH).`);
      out.push(`⏳ The new ${dirW} is <b>not confirmed yet</b>.`);
      out.push(`✅ Confirmed by a ${cl} ${up ? 'above' : 'below'} ${F} (BOS). &nbsp;❌ Fake-out if a ${cl} ${up ? 'below' : 'above'} ${K}.`);
      if (st.shift.n >= 3) out.push(`🎲 On this chart, CHoCHs were confirmed <b>${pct(st.shift.conf, st.shift.n)}</b> of the time (${st.shift.n} cases${st.shift.med != null ? `, usually within ${bars(k, st.shift.med)}` : ''}).`);
      return out;
    }
    if (p.warn.length) {
      for (const w of p.warn) out.push(`⚠ ${WARN_TXT[p.trend][w]}.`);
      out.push(`🛡 The trend is still <b>${up ? 'up' : 'down'}</b> until a ${cl} ${up ? 'below' : 'above'} ${K} — that would be a CHoCH.`);
      const odds = p.warn.filter(w => st[w].n >= 3).map(w => `after "${Structure.WARN[p.trend][w]}" the trend flipped <b>${pct(st[w].flip, st[w].n)}</b> of the time (${st[w].n} cases${st[w].med != null ? `, usually within ${bars(k, st[w].med)}` : ''})`);
      if (odds.length) out.push(`🎲 On this chart, ${odds.join('; ')}.`);
      return out;
    }
    out.push(`✅ ${up ? 'Higher highs and higher lows' : 'Lower highs and lower lows'} — the ${dirW} is intact.`);
    out.push(`🛡 It stays ${up ? 'up' : 'down'} while price holds ${up ? 'above' : 'below'} ${K}${p.key ? ` (the last ${p.key.label})` : ''}.`);
    out.push(p.far ? `🎯 Continuation = a ${cl} ${up ? 'above' : 'below'} ${F} (BOS).` : `🚀 Price is ${up ? 'above every confirmed high' : 'below every confirmed low'} — wait for a new swing ${up ? 'high' : 'low'} to form.`);
    out.push(`👀 First warning signs: ${up ? 'a lower high, or a wick under the HL' : 'a higher low, or a wick over the LH'} — the ribbon under the candles turns orange.`);
    return out;
  }

  function odds(k, st, c) {
    const days = Math.round((c[c.length - 1].t - c[0].t) / 864e5);
    const rows = [['A counter-swing formed (LH in an uptrend / HL in a downtrend)', st.failed.flip, st.failed.n, st.failed.med], ['A wick went beyond the last swing without a close', st.deep.flip, st.deep.n, st.deep.med], ['The key swing was swept (wick through, close held)', st.sweep.flip, st.sweep.n, st.sweep.med], ['A CHoCH was later confirmed by a BOS', st.shift.conf, st.shift.n, st.shift.med]];
    const bar = (a, n) => `<span class="prog"><i style="width:${n ? Math.round(a / n * 100) : 0}%"></i></span>`;
    return `<table class="odds"><tr><th>What happened…</th><th>…then it flipped / confirmed</th></tr>${rows.map(([t, a, n, med]) => `<tr><td>${t}</td><td>${bar(a, n)} <b>${pct(a, n)}</b><br><small>${a} of ${n}${med != null && n ? ` · usually ~${bars(k, med)}` : ''}</small></td></tr>`).join('')}</table>
      <div class="st">Typical run between CHoCHs: <b>${bars(k, st.trendLen) || '—'}</b> · in chop <b>${Math.round(st.rangePct * 100)}%</b> of bars · from the last ${days} days.${rows.some(r => r[2] < 10) ? ' <i>Some samples are small — rough guide only.</i>' : ''}</div>`;
  }

  function story(k, S) {
    const c = S.c, items = [];
    for (const e of S.events.slice(-8)) items.push({ i: e.i, html: `<span class="${e.type === 'CHoCH' ? 'org' : 'blu'}">${e.type} ${e.dir === 'up' ? '↑' : '↓'}</span> @${px(e.level)}${e.type === 'CHoCH' && e.outcome ? (e.outcome === 'fake' ? ' <span class="mut">✗ turned out fake</span>' : ' <span class="grn">✓ confirmed by BOS</span>') : ''}` });
    for (const s of S.sweeps.slice(-6)) if (s.first) items.push({ i: s.i, html: `<span class="gold">$ sweep</span> of ${px(s.level)} <span class="mut">(wick through, close back inside)</span>` });
    for (const s of S.zz.slice(-8)) items.push({ i: s.i, html: `new swing <b class="${s.label === 'HH' || s.label === 'HL' ? 'grn' : 'red'}">${s.label}</b> ${px(s.p)}${s.broken ? ' <span class="mut">(since broken)</span>' : ''}` });
    items.sort((a, b) => b.i - a.i);
    return items.slice(0, 7).map(it => `<li><span class="mut">${k === '1d' ? Data.fmtDay(c[it.i].t) : Data.fmtTime(c[it.i].t)}</span> ${it.html}</li>`).join('');
  }

  function card(k) {
    const S = m.S[k], p = last(k), st = m.pst[k], c = m.closed[k], n = c.length;
    if (!S || !n || !p) return '';
    const price = c[n - 1].c, atr = S.atr[n - 1] || 1, B = badge(p);
    return `<div class="card scard ${k === m.tf ? 'active' : ''}" data-tf="${k}">
      <h3 title="Show this timeframe on the chart"><span class="tfname">${NAME[k]}</span><span class="badge big ${B.cls}">${B.txt}</span></h3>
      <div class="sub">${B.sub}</div>
      ${mini(k, S, p, m.frm[k], price)}${ladder(k, p, price, atr)}
      <ul class="bul">${bullets(k, p, st).map(b => `<li>${b}</li>`).join('')}</ul>
      <details data-k="odds-${k}"><summary>🎲 Odds from this chart's own history</summary>${odds(k, st, c)}</details>
      <details data-k="story-${k}"><summary>📜 Recent events</summary><ul class="story">${story(k, S)}</ul></details>
    </div>`;
  }

  // The verdict: driven by the 1H (direction), with Daily as the big picture and 15m as timing.
  function verdict() {
    const p1 = last('1h'), pd = last('1d'), p15 = last('15m'), st1 = m.pst['1h'];
    const tiles = ['1d', '1h', '15m'].map(k => { const B = badge(last(k)); return `<div class="tile ${B.cls}" data-tf="${k}" title="Jump to the ${NAME[k]} card"><small>${SHORT[k]}</small><b>${B.icon}</b><span>${B.word}</span></div>`; }).join('');
    let v;
    if (!p1 || p1.phase === 'NONE') v = { cls: 'ph-range', icon: '…', head: 'Reading structure…', body: '', needs: [] };
    else {
      const up = p1.trend === 'up', side = up ? 'longs' : 'shorts', K = p1.key ? `<b>${px(p1.key.p)}</b>` : null, F = p1.far ? `<b>${px(p1.far.p)}</b>` : null, agree = pd && pd.trend === p1.trend;
      if (p1.phase === 'RANGE') {
        const top = up ? p1.far : p1.key, bot = up ? p1.key : p1.far;
        v = { icon: '⏸', head: 'Wait — the 1H is choppy', body: 'No clean trend on the 1-hour, so new setups are low quality. Let it pick a side first.', needs: [['Long needs', top ? `a 1H close above <b>${px(top.p)}</b>, then a BOS` : 'a clean break above the range'], ['Short needs', bot ? `a 1H close below <b>${px(bot.p)}</b>, then a BOS` : 'a clean break below the range']] };
      } else if (p1.phase === 'SHIFT') {
        v = { icon: '⏳', head: `1H just flipped ${up ? 'up' : 'down'} — not confirmed`, body: `One break can be a fake-out (on this chart ${pct(st1.shift.n - st1.shift.conf, st1.shift.n)} were). Don't trust ${side} until the BOS prints.`, needs: [[`${up ? 'Longs' : 'Shorts'} need`, F ? `a 1H close ${up ? 'above' : 'below'} ${F} (BOS)` : 'a BOS'], ['Fake-out if', K ? `a 1H close ${up ? 'below' : 'above'} ${K}` : '—']] };
      } else if (p1.warn.length) {
        v = { icon: '⚠', head: `1H ${up ? 'uptrend' : 'downtrend'} has a warning`, body: `${p1.warn.map(w => Structure.WARN[p1.trend][w]).join(' + ')}. Still ${up ? 'up' : 'down'}, but be picky with ${side}: A-grade only, and don't fight a CHoCH.`, needs: [['Trend flips if', K ? `a 1H close ${up ? 'below' : 'above'} ${K}` : '—'], ['Healthy again if', F ? `a 1H close ${up ? 'above' : 'below'} ${F} (BOS)` : 'a new swing forms and breaks']] };
      } else {
        v = { icon: up ? '▲' : '▼', head: `1H is ${up ? 'UP' : 'DOWN'} — ${side} only`, body: agree ? `Daily agrees (${pd.trend}). Good conditions for ${side} — wait for a setup in the Setup tab.` : `Heads-up: Daily is ${pd && pd.trend ? pd.trend : 'unclear'}, so this is counter-trend — be pickier and size down.`, needs: [['Holds while', K ? `the 1H stays ${up ? 'above' : 'below'} ${K}` : '—'], ['Continuation', F ? `a 1H close ${up ? 'above' : 'below'} ${F} (BOS)` : 'price in discovery — wait for a new swing']] };
      }
      v.cls = badge(p1).cls;
    }
    const B15 = badge(p15);
    return `<div class="card verdict"><h3>Right now</h3><div class="tiles">${tiles}</div>
      <div class="vhead ${v.cls}"><span class="vicon">${v.icon}</span><div><b>${v.head}</b><div class="st">${v.body}</div></div></div>
      ${v.needs.length ? `<div class="needs">${v.needs.map(([a, b]) => `<div><small>${a}</small><span>${b}</span></div>`).join('')}</div>` : ''}
      <div class="st" style="margin-top:8px">15m (entry timing): <b>${B15.txt}</b>${B15.sub ? ` — ${B15.sub}` : ''}.<br>Daily = big picture · 1H = direction · 15m = timing.</div></div>`;
  }

  const spill = (t, cls) => `<span class="spill ${cls}">${t}</span>`;
  const legend = `<details class="card legend" data-k="legend"><summary>📖 How to read the chart</summary>
    <svg viewBox="0 0 420 118" width="100%" style="display:block;max-height:150px;margin-top:8px" font-family="system-ui, Segoe UI, sans-serif">
      <polyline points="10,98 45,58 70,78 105,38 130,62 162,50 186,74 212,90 236,72 262,100" fill="none" stroke="#26a69a" stroke-width="2"/>
      <polyline points="162,50 186,74 212,90 236,72 262,100" fill="none" stroke="#ef5350" stroke-width="2"/>
      <line x1="130" y1="62" x2="186" y2="62" stroke="#ff9f43" stroke-dasharray="3 3"/><line x1="212" y1="90" x2="262" y2="90" stroke="#4f8ef7" stroke-dasharray="3 3"/>
      <g font-size="10" font-weight="700"><text x="38" y="52" fill="#26a69a">HH</text><text x="64" y="90" fill="#26a69a">HL</text><text x="98" y="32" fill="#26a69a">HH</text><text x="124" y="74" fill="#26a69a">HL</text><text x="153" y="44" fill="#ff9f43">LH ⚠</text><text x="188" y="60" fill="#ff9f43">CHoCH</text><text x="203" y="104" fill="#ef5350">LL</text><text x="230" y="68" fill="#ef5350">LH</text><text x="266" y="92" fill="#4f8ef7">BOS = confirmed</text></g>
      <rect x="10" y="108" width="152" height="5" fill="rgba(38,166,154,.75)"/><rect x="162" y="108" width="24" height="5" fill="rgba(255,159,67,.85)"/><rect x="186" y="108" width="76" height="5" fill="rgba(239,83,80,.3)"/><rect x="262" y="108" width="150" height="5" fill="rgba(239,83,80,.75)"/>
      <g font-size="9" fill="#8a93a3"><text x="40" y="106">healthy uptrend</text><text x="156" y="106">warning</text><text x="196" y="106">shifting</text><text x="300" y="106">confirmed downtrend</text></g>
      <text x="300" y="30" font-size="10" fill="#8a93a3">1 healthy → 2 warning → 3 CHoCH</text><text x="300" y="44" font-size="10" fill="#8a93a3">→ 4 BOS confirms the new trend</text>
    </svg>
    <ul class="legend">
      <li><span class="grn">—</span> / <span class="red">—</span> zigzag = up-leg / down-leg between confirmed swings</li>
      <li>${spill('HH', 'bull')}${spill('HL', 'bull')} bullish · ${spill('LH', 'bear')}${spill('LL', 'bear')} bearish · faded = already broken · ${spill('HH?', 'forming')} forming, not confirmed (a later bar can still beat it)</li>
      <li><b class="grn">solid green</b> / <b class="red">red</b> line = the level that holds the trend — a <b>close</b> beyond it is a CHoCH · <span class="mut">grey dotted</span> = BOS level (continuation)</li>
      <li>ribbon under the candles: green / red = confirmed trend · <span class="org">orange</span> = ⚠ warning · faded = shifting (CHoCH, waiting for BOS) · grey = chop · orange tick = CHoCH. On the 15m chart the upper row is the 1H.</li>
      <li>Rule of thumb from this chart: a 15m CHoCH alone is a coin flip — wait for the BOS, or read the 1H. A wick through the key swing is the strongest warning.</li>
    </ul></details>`;

  // Keep collapsed sections as the user left them across the once-a-minute re-render.
  const wasOpen = new Set([...root.querySelectorAll('details[data-k]')].filter(d => d.open).map(d => d.dataset.k));
  const firstRender = !root.querySelector('details[data-k]');
  root.innerHTML = verdict() + ['1d', '1h', '15m'].map(card).join('') + legend;
  root.querySelectorAll('details[data-k]').forEach(d => {
    d.open = firstRender ? (d.dataset.k === 'legend' && localStorage.getItem('gs_legend') !== '0') : wasOpen.has(d.dataset.k);
    if (d.dataset.k === 'legend') d.addEventListener('toggle', () => localStorage.setItem('gs_legend', d.open ? '1' : '0'));
  });
  root.querySelectorAll('.scard h3').forEach(h => h.onclick = () => m.onTf && m.onTf(h.parentElement.dataset.tf));
  root.querySelectorAll('.tile').forEach(t => t.onclick = () => {
    const k = t.dataset.tf; if (m.onTf) m.onTf(k);
    const el = root.querySelector(`.scard[data-tf="${k}"]`); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
};
