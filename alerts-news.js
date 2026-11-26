/* =====================================================================
   Vantage · Alerts — Market Watch (advisor-facing; nothing is sent to clients)
   - Price-move alerts: stock / index / USD-INR moves × each client's look-through exposure
   - Each alert: what happened, which clients, ₹ / % exposure, estimated impact, talking points
   - Look-through gaps: international FoFs whose underlying factsheet is missing
   - Backend: /alerts/* (alerts_router.py). Scans also run on schedule (07:30 IST US, 16:00 IST India)
   ===================================================================== */
(function () {
  'use strict';

  const API = () => (localStorage.getItem('mf_analyser_api_url') || 'https://mf-holdings-api.onrender.com').replace(/\/+$/, '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = v => {
    if (v == null || isNaN(v)) return '—';
    const a = Math.abs(v), sign = v < 0 ? '−' : '';
    return sign + (a >= 1e7 ? '₹' + (a / 1e7).toFixed(2) + 'Cr' : a >= 1e5 ? '₹' + (a / 1e5).toFixed(2) + 'L' : '₹' + Math.round(a).toLocaleString('en-IN'));
  };
  const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  const KIND = { stock_move: 'Stock', index_move: 'Index', fx_move: 'Currency' };
  const FIELDS = [
    ['stock_move_pct', 'Stock move ≥ %'], ['index_move_pct', 'Index move ≥ %'], ['fx_move_pct', 'USD/INR move ≥ %'],
    ['min_exposure_pct', 'Material if ≥ % of portfolio'], ['min_exposure_inr', '… or ≥ ₹'],
  ];
  const st = { events: [], open: {}, busy: '', msg: '', fofs: null, cfg: null, showGaps: false, showCfg: false, closed: false };

  async function call(path, opts = {}) {
    const u = window._fb && window._fb.currentUser;
    if (!u) throw new Error('Sign in (top right) to use Market Watch');
    const token = await u.getIdToken();
    const res = await fetch(API() + path, { ...opts, headers: { ...(opts.headers || {}), 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
    if (!res.ok) { let m = await res.text(); try { m = JSON.parse(m).detail || m; } catch (_) {} throw new Error(m); }
    return res.json();
  }

  // ------------------------------------------------------------------ actions
  async function loadFeed() {
    const j = await call(`/alerts/feed?days=7&include_closed=${st.closed}`);
    st.events = j.events || [];
  }
  async function loadRuns() {
    try { const j = await call('/alerts/runs?limit=2'); st.lastRuns = j.runs || []; } catch (_) { st.lastRuns = []; }
  }
  async function act(label, fn) {
    st.busy = label; st.msg = ''; draw();
    try { await fn(); } catch (e) { st.msg = '⚠ ' + e.message; }
    st.busy = ''; draw();
  }
  const MW = window.MarketWatch = {
    async render() {
      if (!document.getElementById('mw-root')) return;
      await act('Loading…', async () => { await Promise.all([loadFeed(), loadRuns()]); });
    },
    scan(market) {
      return act(`Scanning ${market === 'in' ? 'India' : 'US'}… (wakes the server; up to a minute)`, async () => {
        const r = await call(`/alerts/scan?market=${market}&wait=true`, { method: 'POST' });
        st.msg = r.status === 'ok'
          ? `Scan done: ${r.clients} clients, ${r.watched} securities watched, ${r.prices} prices, ${r.created} new alert(s)` +
            (r.price_failures ? ` · ${r.price_failures} price fetches failed` : '') + (r.no_ticker?.length ? ` · ${r.no_ticker.length} without ticker` : '')
          : '⚠ Scan failed: ' + (r.error || 'unknown');
        await Promise.all([loadFeed(), loadRuns()]);
      });
    },
    rebuild() {
      return act('Rebuilding client exposure…', async () => {
        const r = await call('/alerts/exposure/rebuild', { method: 'POST' });
        st.msg = `Exposure rebuilt: ${r.clients} clients across ${r.funds_resolved} matched funds`;
        st.fofs = null;
      });
    },
    async status(id, status) {
      try { await call(`/alerts/item/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status }) }); await loadFeed(); }
      catch (e) { st.msg = '⚠ ' + e.message; }
      draw();
    },
    toggle(k) { st.open[k] = !st.open[k]; draw(); },
    toggleClosed() { st.closed = !st.closed; MW.render(); },
    async gaps() {
      st.showGaps = !st.showGaps;
      if (st.showGaps && !st.fofs) return act('Loading FoF look-through…', async () => { st.fofs = await call('/alerts/fofs'); });
      draw();
    },
    async cfg() {
      st.showCfg = !st.showCfg;
      if (st.showCfg && !st.cfg) return act('Loading thresholds…', async () => { st.cfg = (await call('/alerts/config')).thresholds; });
      draw();
    },
    saveCfg() {
      const th = {};
      FIELDS.forEach(([k]) => { const el = document.getElementById('mw-cfg-' + k); if (el) th[k] = parseFloat(el.value); });
      return act('Saving…', async () => { st.cfg = (await call('/alerts/config', { method: 'PUT', body: JSON.stringify({ thresholds: th }) })).thresholds; st.msg = 'Thresholds saved — apply from the next scan'; });
    },
  };

  // ------------------------------------------------------------------ view
  function eventCard(g, i) {
    const key = `${g.kind}|${g.entity.key}|${g.session_date}`;
    const open = st.open[key] ?? i < 2;
    const col = g.move_pct < 0 ? 'var(--red)' : 'var(--green)';
    const clients = g.clients.map(a => `
      <div style="border-top:1px solid var(--border);padding:.55rem 0">
        <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:baseline">
          <div style="font-weight:600;font-size:.74rem">${esc(a.client_name)}</div>
          <div style="font-size:.66rem;white-space:nowrap">
            exposure <b>${inr(a.exposure_inr)}</b> (${a.exposure_pct.toFixed(2)}%) · impact
            <b style="color:${a.est_impact_inr < 0 ? 'var(--red)' : 'var(--green)'}">${inr(a.est_impact_inr)}</b> (${sgn(a.est_impact_pct)}%)
          </div>
        </div>
        ${a.via?.length ? `<div style="font-size:.6rem;color:var(--muted2);margin:.15rem 0">via ${a.via.slice(0, 4).map(v => `${esc(v.fund)} ${inr(v.inr)} (${v.pct.toFixed(2)}% of fund)`).join(' · ')}</div>` : ''}
        <ul style="margin:.3rem 0 .35rem 1rem;padding:0;font-size:.66rem;line-height:1.45;color:var(--text)">
          ${a.talking_points.map(t => `<li>${esc(t)}</li>`).join('')}
        </ul>
        <div style="display:flex;gap:.35rem;align-items:center">
          ${a.status === 'new'
            ? `<button class="btn" onclick="MarketWatch.status('${a.id}','called')">✓ Called</button>
               <button class="btn" onclick="MarketWatch.status('${a.id}','dismissed')">Dismiss</button>`
            : `<span style="font-size:.6rem;color:var(--muted)">${esc(a.status)}</span>
               <button class="btn" onclick="MarketWatch.status('${a.id}','new')">Reopen</button>`}
          ${a.exposure_as_of ? `<span style="font-size:.56rem;color:var(--muted);margin-left:auto">exposure as of ${esc(String(a.exposure_as_of).slice(0, 10))} · factsheet month-end holdings</span>` : ''}
        </div>
      </div>`).join('');
    return `
      <div style="border:1px solid var(--border);border-left:3px solid ${col};border-radius:var(--r-md);padding:.6rem .85rem;margin-bottom:.6rem">
        <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="MarketWatch.toggle('${esc(key)}')">
          <div>
            <span style="font-size:.56rem;padding:1px 6px;border-radius:3px;background:var(--s3);margin-right:.4rem">${KIND[g.kind] || g.kind}</span>
            <span style="font-weight:600;font-size:.8rem">${esc(g.headline)}</span>
            ${g.severity === 'high' ? '<span class="alert-tag breach" style="margin-left:.4rem">high</span>' : ''}
            <span style="font-size:.6rem;color:var(--muted);margin-left:.4rem">${esc(g.session_date)}${g.entity.symbol ? ' · ' + esc(g.entity.symbol) : ''}</span>
          </div>
          <div style="font-size:.66rem;white-space:nowrap">${g.clients.length} client${g.clients.length === 1 ? '' : 's'} · total impact
            <b style="color:${g.total_impact_inr < 0 ? 'var(--red)' : 'var(--green)'}">${inr(g.total_impact_inr)}</b> ${open ? '▾' : '▸'}</div>
        </div>
        ${open ? clients : ''}
      </div>`;
  }

  function gapsView() {
    if (!st.showGaps || !st.fofs) return '';
    const intl = st.fofs.fofs.filter(f => f.vehicle === 'fof_intl');
    const rows = intl.map(f => `
      <tr><td>${esc(f.fund_name)}<div style="font-size:.56rem;color:var(--muted)">${esc(f.amc || '')}${f.held_by_clients.clients ? ` · ${f.held_by_clients.clients} client(s), ${inr(f.held_by_clients.inr)}` : ''}</div></td>
      <td>${f.units.map(u => `<div style="font-size:.62rem">${u.status === 'linked' ? '✓' : '<b style="color:var(--red)">upload</b>'} ${esc(u.name)} (${(+u.pct || 0).toFixed(1)}%)${u.linked_name ? ` → ${esc(u.linked_name)}` : ''}</div>`).join('')}</td></tr>`).join('');
    const nf = (st.fofs.client_funds_without_factsheet || []);
    return `
      <div style="margin-top:.6rem">
        <div style="font-size:.68rem;font-weight:600;margin-bottom:.3rem">International FoFs — underlying fund factsheets</div>
        <div style="font-size:.6rem;color:var(--muted2);margin-bottom:.35rem">An FoF's factsheet shows only the overseas fund it buys. Upload that fund's monthly holdings so the stocks underneath (e.g. NVIDIA) can be matched. "upload" rows are missing.</div>
        ${intl.length ? `<table class="tbl" style="width:100%;font-size:.64rem"><tbody>${rows}</tbody></table>` : '<div style="font-size:.62rem;color:var(--muted)">No international FoFs in uploaded factsheets.</div>'}
        ${nf.length ? `<div style="font-size:.68rem;font-weight:600;margin:.7rem 0 .3rem">Client funds with no factsheet matched</div>
          ${nf.map(u => `<div style="font-size:.62rem">${u.looks_international ? '<b style="color:#7b68ee">INTL</b> ' : ''}${esc(u.scheme)} — ${u.clients} client(s), ${inr(u.inr)}</div>`).join('')}` : ''}
      </div>`;
  }

  function cfgView() {
    if (!st.showCfg || !st.cfg) return '';
    return `<div style="display:flex;flex-wrap:wrap;gap:.6rem;align-items:flex-end;margin-top:.6rem">
      ${FIELDS.map(([k, l]) => `<label style="font-size:.6rem;color:var(--muted2)">${l}<br>
        <input id="mw-cfg-${k}" class="thresh-input" type="number" step="any" value="${st.cfg[k]}" style="width:7rem"></label>`).join('')}
      <button class="btn pri" onclick="MarketWatch.saveCfg()">Save</button></div>`;
  }

  function draw() {
    const root = document.getElementById('mw-root');
    if (!root) return;
    const lr = (st.lastRuns || []).map(r => `${r.market === 'in' ? 'India' : 'US'} ${String(r.started_at || '').slice(0, 16).replace('T', ' ')} UTC · ${r.status}${r.created != null ? ` · ${r.created} new` : ''}`).join(' | ');
    root.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:.35rem;align-items:center;margin-bottom:.5rem">
        <button class="btn pri" ${st.busy ? 'disabled' : ''} onclick="MarketWatch.scan('in')">⟳ Scan India</button>
        <button class="btn pri" ${st.busy ? 'disabled' : ''} onclick="MarketWatch.scan('us')">⟳ Scan US</button>
        <button class="btn" ${st.busy ? 'disabled' : ''} onclick="MarketWatch.rebuild()">Rebuild exposure</button>
        <button class="btn" onclick="MarketWatch.gaps()">FoF look-through ${st.showGaps ? '▾' : '▸'}</button>
        <button class="btn" onclick="MarketWatch.cfg()">Thresholds ${st.showCfg ? '▾' : '▸'}</button>
        <label style="font-size:.6rem;color:var(--muted2);margin-left:auto"><input type="checkbox" ${st.closed ? 'checked' : ''} onchange="MarketWatch.toggleClosed()"> show called/dismissed</label>
      </div>
      ${st.busy ? `<div style="font-size:.64rem;color:var(--accent);margin-bottom:.4rem">${esc(st.busy)}</div>` : ''}
      ${st.msg ? `<div style="font-size:.64rem;color:var(--muted2);margin-bottom:.4rem">${esc(st.msg)}</div>` : ''}
      ${lr ? `<div style="font-size:.56rem;color:var(--muted);margin-bottom:.5rem">Last runs: ${esc(lr)} · scheduled 07:30 IST (US) and 16:00 IST (India)</div>` : ''}
      ${cfgView()}${gapsView()}
      <div style="margin-top:.6rem">${st.events.length ? st.events.map(eventCard).join('')
        : `<div style="color:var(--muted);font-size:.65rem;padding:.5rem">No open alerts in the last 7 days.</div>`}</div>`;
  }
})();
