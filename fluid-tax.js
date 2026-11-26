/* =====================================================================
   Vantage · Fluid Tax module
   - Plugs tax cards + triggers into the Fluid co-pilot (index.html)
   - Tax Desk overlay: lookup, calculator, entity compare, harvesting, rule updates
   - All rules come from the backend (/tax/rules); nothing is hardcoded here
   ===================================================================== */
(function () {
  'use strict';

  const API = () => (localStorage.getItem('mf_analyser_api_url') || 'https://mf-holdings-api.onrender.com').replace(/\/+$/, '');
  const CACHE_KEY = 'fluid_tax_rules_cache_v1';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = n => (n == null || isNaN(n)) ? '—' : '₹' + Math.round(n).toLocaleString('en-IN');
  const pct = v => v === 'slab' ? 'slab rate' : (v == null ? '—' : v + '%');

  let R = null;            // merged ruleset
  let loading = null;

  // ------------------------------------------------------------------ data
  function loadRules(force) {
    if (R && !force) return Promise.resolve(R);
    if (loading && !force) return loading;
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (c && !R) R = c; } catch (_) {}
    loading = fetch(API() + '/tax/rules').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(j => { R = j; try { localStorage.setItem(CACHE_KEY, JSON.stringify(j)); } catch (_) {} hydrateStash(); return R; })
      .catch(e => { console.warn('[fluid-tax] rules fetch failed', e); if (R) hydrateStash(); return R; })
      .finally(() => { loading = null; });
    return loading;
  }

  async function authed(path, opts = {}) {
    const u = window._fb && window._fb.currentUser;
    if (!u) throw new Error('Sign in (top right) to manage tax updates');
    const token = await u.getIdToken();
    const res = await fetch(API() + path, { ...opts, headers: { ...(opts.headers || {}), 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
    if (!res.ok) { let m = await res.text(); try { m = JSON.parse(m).detail || m; } catch (_) {} throw new Error(m); }
    return res.json();
  }
  async function post(path, body) {
    const res = await fetch(API() + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { let m = await res.text(); try { m = JSON.parse(m).detail || m; } catch (_) {} throw new Error(m); }
    return res.json();
  }

  const asset = id => R && R.capital_gains.assets.find(a => a.id === id);
  const vbadge = b => b && b.verified === false ? '<span class="txv txv-u" title="Flagged for verification by the update agent">verify</span>' : '';

  // ------------------------------------------------------------------ talking points
  function hydrateStash() {
    if (!R || typeof FLUID_STASH === 'undefined') return;
    const ex = R.capital_gains.common.ltcg_112A_exemption;
    const eq = asset('listed_equity');
    FLUID_STASH.tax_equity = { talking_points: [
      `Equity held over ${eq.lt_months} months: ${eq.ltcg}% on gains above ${inr(ex)} a year. Under ${eq.lt_months} months: ${eq.stcg}%.`,
      `Every year you can book up to ${inr(ex)} of long-term equity gains tax-free — harvesting resets your cost without paying tax.`,
      `Short-term losses can offset any capital gain; long-term losses only long-term gains. Unused losses carry forward 8 years if you file on time.`,
    ]};
    FLUID_STASH.tax_debt = { talking_points: [
      'Debt funds bought after 1 Apr 2023 are taxed at your slab rate whatever the holding period — same as an FD, but tax is only paid when you redeem, not every year.',
      'FD interest is taxed every year as it accrues; a debt fund defers tax until redemption, which compounds better for the same pre-tax return.',
      'Hybrid / multi-asset funds with 35–65% equity get 12.5% long-term tax after 24 months — often the most tax-efficient middle ground.',
    ]};
    FLUID_STASH.tax_gold = { talking_points: [
      'Gold ETFs: 12.5% long-term after 12 months. Gold FoFs and physical gold: 12.5% after 24 months.',
      'Since Budget 2026, SGBs are tax-free at maturity only if bought at original issue from RBI and held to maturity. Exchange-bought SGBs pay 12.5% LTCG.',
    ]};
    FLUID_STASH.tax_entity = { talking_points: [
      'An HUF is a separate taxpayer — its own slabs and its own ₹1.25 lakh equity LTCG exemption.',
      'A private discretionary trust is taxed at the maximum marginal rate (up to ~39%) — structure matters before investing through one.',
      'Companies under 115BAA pay ~25.2% all-in on debt fund gains; individuals in the top slab can pay up to ~39%.',
    ]};
    FLUID_STASH.tax_nri = { talking_points: [
      'NRIs pay the same capital gains rates, but tax is deducted at source on redemption; DTAA relief needs a TRC and Form 10F.',
      'NRIs do not get the 87A rebate or the basic-exemption offset against capital gains.',
    ]};
    FLUID_STASH.tax_changes = { talking_points: (R.changes_2026 || []).slice(0, 5).map(c => c.what) };
  }

  // ------------------------------------------------------------------ triggers
  const TAX_TRIGGERS = [
    { patterns: ['ltcg', 'stcg', 'capital gain', 'tax on gain', 'tax harvesting', 'harvest', 'post tax', 'post-tax', 'after tax', '1.25 lakh', 'exemption limit', 'how much tax', 'tax evlo', 'tax evvalavu', 'tax ethra', 'tax kitna', 'tax entha'],
      cards: ['f_tax_equity', 'f_tax_harvest', 'f_tax_calc'], key: 'tax_equity' },
    { patterns: ['set off', 'set-off', 'carry forward', 'book loss', 'tax loss', 'capital loss'],
      cards: ['f_tax_harvest', 'f_tax_equity'], key: 'tax_equity' },
    { patterns: ['debt fund tax', 'debt tax', 'fd tax', 'tax on fd', 'interest taxable', 'slab rate', 'indexation', 'liquid fund tax', 'arbitrage tax'],
      cards: ['f_tax_debt', 'f_tax_calc'], key: 'tax_debt' },
    { patterns: ['sgb tax', 'gold tax', 'gold bond tax', 'tax on gold', 'gold etf tax', 'sgb maturity'],
      cards: ['f_tax_gold'], key: 'tax_gold' },
    { patterns: [' huf', 'huf ', 'private trust', 'family trust', 'discretionary trust', 'trust structure', ' llp', 'partnership firm', 'company invest', 'corporate treasury', 'through company', 'through the company'],
      cards: ['f_tax_entity'], key: 'tax_entity' },
    { patterns: [' nri', 'nri ', 'non resident', 'non-resident', ' tds', 'tds ', 'dtaa', 'nre account', 'nro account'],
      cards: ['f_tax_nri'], key: 'tax_nri' },
    { patterns: ['pfic', 'green card', 'us citizen', 'us person', 'american citizen', 'form 8621', 'fbar', 'irs', 'fatca', 'hmrc', 'offshore fund', 'reporting fund', 't1135', 'cra '],
      cards: ['f_tax_home', 'f_tax_dtaa'], key: 'tax_nri' },
    { patterns: ['dtaa', 'treaty', 'dubai', 'uae', 'abu dhabi', 'singapore', ' usa', 'united states', 'america', ' uk ', 'london', 'canada', 'toronto', 'australia', 'sydney', 'melbourne', 'trc', 'form 10f', 'double tax'],
      cards: ['f_tax_dtaa', 'f_tax_nri'], key: 'tax_nri' },
    { patterns: ['rnor', 'returning nri', 'moving back to india', 'coming back to india', 'oci', 'pio', 'foreign citizen', 'foreign national', 'expat', 'residential status', 'resident status', 'green card', 'us citizen'],
      cards: ['f_tax_residency', 'f_tax_nri'], key: 'tax_nri' },
    { patterns: ['gift to', 'gifting', 'clubbing', 'in wife\'s name', 'in my wife', 'in my son', 'in my daughter', 'minor', 'parents name', 'save tax', 'tax efficient', 'tax-efficient', 'private limited', 'pvt ltd', 'holding company', 'family office'],
      cards: ['f_tax_planning', 'f_tax_entity'], key: 'tax_entity' },
    { patterns: ['budget', 'new tax act', 'income tax act 2025', 'tax change', 'tax rule', 'buyback', 'new regime', 'old regime'],
      cards: ['f_tax_changes'], key: 'tax_changes' },
    { patterns: ['tax', 'taxation', 'taxable', 'tax free', 'tax-free'],
      cards: ['f_tax_equity', 'f_tax_changes'], key: 'tax_equity' },
  ];

  // ------------------------------------------------------------------ cards
  function row(l, r, extra) { return `<div class="txr"><span>${l}</span><b>${r}</b>${extra || ''}</div>`; }
  function foot() { return R ? `<div class="txfoot">Rules ${esc(R.version)} · TY ${esc(R.meta.tax_year)} · <a href="#" onclick="openTaxDesk();return false">Tax Desk →</a></div>` : ''; }
  function wait(id, label, title) {
    loadRules().then(() => { const el = document.getElementById('fc-' + id); if (el) { const tmp = document.createElement('div'); tmp.innerHTML = renderTax(id); el.replaceWith(tmp.firstElementChild); } });
    return fCard(id, label, title, '<div class="txmuted">Loading tax rules…</div>');
  }

  function renderTax(id) {
    if (!R) return wait(id, 'Tax', 'Tax');
    const ex = R.capital_gains.common.ltcg_112A_exemption;
    switch (id) {
      case 'f_tax_equity': {
        const e = asset('equity_mf');
        return fCard(id, 'Tax · Equity', 'Equity & equity funds',
          row(`Long-term (> ${e.lt_months} m)`, `${pct(e.ltcg)} above ${inr(ex)}/yr`) +
          row(`Short-term (≤ ${e.lt_months} m)`, pct(e.stcg)) +
          row('Indexation', 'Not available') +
          row('Pre-Feb 2018 holdings', 'Grandfathered at 31-Jan-2018 FMV') +
          `<div class="ftp"><strong>Say:</strong> ${esc(FLUID_STASH.tax_equity.talking_points[1])}</div>` + foot());
      }
      case 'f_tax_harvest':
        return fCard(id, 'Tax · Opportunity', 'Harvest the ₹1.25 lakh exemption',
          `<div class="txmuted" style="margin-bottom:.4rem">Gains already booked this tax year (equity LTCG):</div>
           <div class="txform"><input type="number" id="txh-used" placeholder="0" min="0"><button onclick="FluidTax.quickHarvest()">Headroom</button></div>
           <div id="txh-out" class="txout"></div>
           <div class="ftp"><strong>Losses:</strong> ${esc(R.set_off.rules[0])} ${esc(R.set_off.rules[1])}</div>` + foot());
      case 'f_tax_debt': {
        const post = asset('debt_mf_post_apr2023'), pre = asset('debt_mf_pre_apr2023'), oth = asset('other_mf');
        return fCard(id, 'Tax · Debt & hybrid', 'Debt funds, FDs, hybrids',
          row('Debt MF bought ≥ 1 Apr 2023', 'Slab rate, any holding') +
          row('Debt MF bought before', `> ${pre.lt_months} m: ${pct(pre.ltcg)}; else slab`) +
          row('Hybrid 35–65% equity, intl, gold FoF', `> ${oth.lt_months} m: ${pct(oth.ltcg)}; else slab`) +
          row('FD / bond interest', 'Slab, taxed yearly') +
          row('Interest on loans vs dividend/MF income', 'Not deductible (from Apr 2026)') +
          `<div class="ftp"><strong>Say:</strong> ${esc(FLUID_STASH.tax_debt.talking_points[1])}</div>` + foot());
      }
      case 'f_tax_gold': {
        const s = asset('sgb'), etf = asset('commodity_intl_etf'), pg = asset('physical_gold');
        return fCard(id, 'Tax · Gold', 'Gold: ETF vs FoF vs SGB vs physical',
          row('Gold ETF', `> ${etf.lt_months} m: ${pct(etf.ltcg)}; else slab`) +
          row('Gold FoF / physical', `> ${pg.lt_months} m: ${pct(pg.ltcg)}; else slab`) +
          row('SGB — original issue, held to maturity', 'Exempt' , vbadge(s)) +
          row('SGB — bought on exchange', `> ${s.lt_months} m: ${pct(s.ltcg)}; else slab`) +
          row('SGB interest 2.5%', 'Slab') +
          `<div class="ftp"><strong>Budget 2026:</strong> ${esc(FLUID_STASH.tax_gold.talking_points[1])}</div>` + foot());
      }
      case 'f_tax_entity': {
        const cmp = R.entities.company_domestic.options.find(o => o.id === '115BAA');
        return fCard(id, 'Tax · Structures', 'Who should hold the investment?',
          row('Individual (new regime)', 'Slabs 0–30%, surcharge ≤ 25%') +
          row('HUF', 'Own slabs + own ₹1.25L exemption') +
          row('Discretionary trust', `MMR ~${R.mmr.tax_year_2026_27_max_effective_pct}%`) +
          row('Firm / LLP', `${R.entities.firm_llp.rate}% + 12% SC > ₹1 Cr`) +
          row('Company 115BAA', `${cmp.rate}% (≈${cmp.effective_max}% all-in)`) +
          row('Company MAT (old regime)', `${R.entities.company_domestic.mat.rate}% — final tax`) +
          `<div class="txmuted" style="margin-top:.5rem">Compare the same gain across structures in the <a href="#" onclick="openTaxDesk('compare');return false">Tax Desk</a>.</div>` + foot());
      }
      case 'f_tax_nri': {
        const nri = R.tds.nri;
        return fCard(id, 'Tax · NRI', 'NRI: TDS on redemption',
          nri.map(t => row(esc(t.item), pct(t.rate) + (t.plus ? ' +SC+cess' : ''), vbadge(t))).join('') +
          `<div class="ftp"><strong>Say:</strong> ${esc(FLUID_STASH.tax_nri.talking_points[0])}</div>` + foot());
      }
      case 'f_tax_residency': {
        const st = (R.residency || {}).statuses || {};
        return fCard(id, 'Tax · Residency', 'Resident, RNOR, NRI, OCI — what is taxed',
          Object.entries(st).map(([k, v]) => row(k, esc(v.scope.split(';')[0].split('.')[0]))).join('') +
          `<div class="ftp"><strong>Say:</strong> ${esc((R.residency || {}).principle || '')}</div>` +
          `<div class="txmuted">Returning NRI? ${esc((R.structuring.find(x => x.id === 'rnor_window') || { points: [''] }).points[0])}</div>` + foot());
      }
      case 'f_tax_planning': {
        const pick = ['huf_split', 'gift_parents', 'clubbing_traps', 'llp_vs_company'].map(k => (R.structuring || []).find(x => x.id === k)).filter(Boolean);
        return fCard(id, 'Tax · Planning', 'Structuring for tax efficiency',
          pick.map(p => `<div class="txr"><span>${esc(p.title)}</span></div><div class="txnote">${esc(p.points[0])}</div>`).join('') +
          `<div class="txmuted"><a href="#" onclick="openTaxDesk('planning');return false">All planning notes →</a></div>` + foot());
      }
      case 'f_tax_dtaa': {
        const cs = (R.dtaa || { countries: [] }).countries;
        return fCard(id, 'Tax · NRI treaties', 'DTAA: what an NRI actually pays',
          `<table class="txt"><thead><tr><th></th><th>Div.</th><th>NRO int.</th><th>MF gains</th></tr></thead><tbody>${cs.map(c => `<tr><td>${esc(c.name)}</td><td>${c.dividend.individual_effective}%</td><td>${c.interest.nro_effective}%</td><td>${c.mf_units_residence_only ? 'Claimable exempt*' : 'India rates'}</td></tr>`).join('')}</tbody></table>
          <div class="txnote">* Tribunal view (MF units ≠ shares); contested — keep TRC, Form 10F, stay records.</div>
          <div class="ftp"><strong>Say:</strong> You pay the lower of the Indian rate and the treaty rate — we need your TRC and Form 10F before the payout.</div>` + foot());
      }
      case 'f_tax_home': {
        const h = R.home_country; if (!h) return null;
        const rows = h.products.filter(r => /mutual funds|PMS|ETFs|NRE/.test(r.product));
        return fCard(id, 'Tax · Home country', 'Taxed abroad? The wrapper matters',
          `<table class="txt"><thead><tr><th></th><th>US</th><th>UK</th><th>CA</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.product.split(' (')[0])}</td>${['us', 'uk', 'canada'].map(c => `<td><span class="txfit txfit-${r[c][0]}">${r[c][0] === 'ok' ? '✓' : r[c][0] === 'caution' ? '⚠' : '✕'}</span></td>`).join('')}</tr>`).join('')}</tbody></table>
          <div class="ftp"><strong>Say:</strong> For a US person, Indian mutual funds are PFICs — punitive US tax and a Form 8621 per fund every year. A PMS or direct shares avoid that.</div>
          <div class="txmuted"><a href="#" onclick="openTaxDesk('dtaa');return false">Full matrix →</a></div>` + foot());
      }
      case 'f_tax_changes':
        return fCard(id, 'Tax · What changed', 'Tax changes in force for TY ' + esc(R.meta.tax_year),
          '<ul class="txul">' + (R.changes_2026 || []).map(c => `<li>${esc(c.what)}</li>`).join('') + '</ul>' + foot());
      case 'f_tax_calc':
        return fCard(id, 'Tax · Calculator', 'Quick tax on a redemption',
          `<div class="txform txgrid">
             <select id="txq-asset">${assetOptions()}</select>
             <select id="txq-entity">${entityOptions()}</select>
             <input type="number" id="txq-gain" placeholder="Gain ₹">
             <input type="number" id="txq-months" placeholder="Held (months)">
             <input type="number" id="txq-income" placeholder="Other income ₹ (yr)">
             <button onclick="FluidTax.quickCalc()">Calculate</button>
           </div><div id="txq-out" class="txout"></div>` + foot());
      default: return null;
    }
  }

  const SHORT = { listed_equity: 'Listed equity shares', equity_mf: 'Equity MF / ETF / ELSS / arbitrage', debt_mf_post_apr2023: 'Debt MF (bought ≥ Apr 2023)',
    debt_mf_pre_apr2023: 'Debt MF (bought < Apr 2023)', other_mf: 'Hybrid 35–65% / intl / gold FoF', commodity_intl_etf: 'Gold / silver / intl ETF',
    sif: 'SIF units', listed_bond: 'Listed bond / NCD', unlisted_bond: 'Unlisted bond', mld: 'Market-linked debenture', sgb: 'Sovereign Gold Bond',
    physical_gold: 'Physical gold / silver', unlisted_equity: 'Unlisted / foreign shares', real_estate: 'Land / building', reit_invit_units: 'REIT / InvIT units',
    ulip_high_premium: 'ULIP (premium > ₹2.5L)', aif_units: 'AIF units', pms: 'PMS', vda: 'Crypto / VDA', buyback: 'Share buyback',
    ipo_shares: 'IPO / FPO shares', sme_shares: 'SME-exchange shares', bonus_rights: 'Bonus / rights shares', esop_rsu_listed_india: 'ESOP/RSU — Indian listed',
    esop_rsu_foreign: 'ESOP/RSU — foreign/unlisted', preference_shares: 'Preference shares', warrants: 'Warrants', foreign_equity: 'Foreign stocks/ETFs/MFs (LRS)',
    adr_gdr: 'ADR / GDR', gift_city_fund: 'GIFT City (IFSC) funds', g_sec: 'G-secs / SDLs', t_bill_cp_cd: 'T-bills / CP / CD', perpetual_bond: 'Perpetual / AT1 bonds',
    deep_discount_bond: 'Deep discount bonds', securitised_debt: 'PTCs / securitised debt', egr: 'Electronic Gold Receipts', digital_gold: 'Digital gold',
    gold_monetisation: 'Gold Monetisation Scheme', art_collectibles: 'Art & collectibles', sm_reit: 'SM REIT units', fractional_realty: 'Fractional real estate', nft: 'NFTs' };
  function assetOptions(sel) {
    const groups = {};
    R.capital_gains.assets.filter(a => a.stcg !== undefined || a.flat != null || a.exempt_all || ['sif', 'ulip_high_premium', 'buyback'].includes(a.id))
      .forEach(a => (groups[a.cat || 'Other'] = groups[a.cat || 'Other'] || []).push(a));
    return (R.categories || Object.keys(groups)).filter(c => groups[c]).map(c => `<optgroup label="${esc(c)}">` +
      groups[c].map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(SHORT[a.id] || a.label.split(' (')[0])}</option>`).join('') + '</optgroup>').join('');
  }
  const ENTITY_LIST = [
    ['individual_resident', 'Individual (resident)'], ['individual_nri', 'NRI'], ['huf', 'HUF'],
    ['trust_private_discretionary', 'Discretionary trust'], ['aop_mmr', 'AOP at MMR'], ['firm_llp', 'Firm / LLP'],
    ['company_115BAA', 'Company 115BAA'], ['company_normal_small', 'Company 25%'], ['company_normal', 'Company 30%'],
  ];
  function entityOptions(sel) {
    if (!R) return ENTITY_LIST.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');
    const groups = {};
    Object.entries(R.entities).filter(([k, e]) => e.engine).forEach(([k, e]) => (groups[e.group || 'Other'] = groups[e.group || 'Other'] || []).push([k, e]));
    const order = ['Individuals', 'Family structures', 'Trusts', 'Firms & LLPs', 'Companies', 'Foreign investors', 'AOP / BOI / others', 'Charitable', 'Pooled vehicles', 'Other'];
    return order.filter(g => groups[g]).map(g => `<optgroup label="${esc(g)}">` +
      groups[g].map(([k, e]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(e.label)}</option>`).join('') + '</optgroup>').join('');
  }

  function datesFromMonths(m) {
    const sale = new Date(); const p = new Date(sale); p.setMonth(p.getMonth() - Math.max(0, Math.round(+m || 0))); p.setDate(p.getDate() - 1);
    return { purchase_date: p.toISOString().slice(0, 10), sale_date: sale.toISOString().slice(0, 10) };
  }

  function resultHTML(r) {
    const l = r.lines[0];
    return `<div class="txres">
      ${l ? `<div class="txmuted">${esc(l.reason)}</div>` : ''}
      ${row('Tax caused by this gain', inr(r.tax_on_gains_only))}
      ${row('Total tax for the year', inr(r.tax.total))}
      ${r.exemption_112A_used ? row('112A exemption used', inr(r.exemption_112A_used)) : ''}
      ${r.basic_exemption_used_vs_cg ? row('Basic exemption used', inr(r.basic_exemption_used_vs_cg)) : ''}
      ${r.tax.surcharge ? row('Surcharge', `${inr(r.tax.surcharge)} (${r.tax.surcharge_rate}%)`) : ''}
      ${r.notes.map(n => `<div class="txnote">${esc(n)}</div>`).join('')}
    </div>`;
  }

  // ------------------------------------------------------------------ hook into Fluid
  function install() {
    if (typeof FLUID_TRIGGERS === 'undefined' || typeof fRender !== 'function') return false;
    if (window.__fluidTaxInstalled) return true;
    window.__fluidTaxInstalled = true;
    // tax triggers first so "tax on gold" prefers tax cards; generic 'tax' last
    TAX_TRIGGERS.slice().reverse().forEach(t => FLUID_TRIGGERS.unshift(t));
    const base = fRender;
    window.fRender = function (type) { return String(type).startsWith('f_tax_') ? renderTax(type) : base(type); };
    try { fRender = window.fRender; } catch (_) {}
    injectButton();
    loadRules();
    return true;
  }

  function injectButton() {
    const demo = document.getElementById('fluid-demo-btn');
    if (!demo || document.getElementById('fluid-tax-btn')) return;
    const b = document.createElement('button');
    b.id = 'fluid-tax-btn'; b.type = 'button'; b.textContent = '₹ Tax Desk';
    b.className = demo.className; b.setAttribute('style', demo.getAttribute('style') || '');
    b.onclick = () => openTaxDesk();
    demo.insertAdjacentElement('afterend', b);
  }

  // ------------------------------------------------------------------ quick actions in cards
  async function quickCalc() {
    const out = document.getElementById('txq-out'); if (!out) return;
    out.innerHTML = '<div class="txmuted">Calculating…</div>';
    try {
      const r = await post('/tax/compute', {
        entity: document.getElementById('txq-entity').value,
        normal_income: +document.getElementById('txq-income').value || 0,
        gains: [{ asset_id: document.getElementById('txq-asset').value, gain: +document.getElementById('txq-gain').value || 0,
                  ...datesFromMonths(document.getElementById('txq-months').value) }],
      });
      out.innerHTML = resultHTML(r);
    } catch (e) { out.innerHTML = `<div class="txerr">${esc(e.message)}</div>`; }
  }
  async function quickHarvest() {
    const out = document.getElementById('txh-out'); if (!out) return;
    try {
      const r = await post('/tax/harvest', { realised_112A_net: +document.getElementById('txh-used').value || 0, lots: [] });
      out.innerHTML = row('Still tax-free this year', inr(r.headroom)) + row('Tax saved by booking it now', inr(r.headroom * 0.125 * 1.04)) +
        `<div class="txnote">${esc(r.note)}</div>`;
    } catch (e) { out.innerHTML = `<div class="txerr">${esc(e.message)}</div>`; }
  }

  // ------------------------------------------------------------------ Tax Desk overlay
  let deskTab = 'lookup';
  function openTaxDesk(tab) {
    deskTab = tab || deskTab;
    let el = document.getElementById('tax-desk');
    if (!el) {
      el = document.createElement('div'); el.id = 'tax-desk';
      el.innerHTML = `<div class="txd-panel">
        <div class="txd-head"><div><div class="txd-title">Tax Desk</div><div class="txd-sub" id="txd-sub"></div></div>
          <div class="txd-tabs">${[['lookup', 'Instruments'], ['structures', 'Structures & residency'], ['dtaa', 'NRI treaties'], ['eligibility', 'Who can invest'], ['planning', 'Planning'], ['calc', 'Calculator'], ['compare', 'Compare'], ['harvest', 'Harvest'], ['updates', 'Rule updates'], ['sources', 'Sources']]
            .map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
          <button class="txd-x" onclick="closeTaxDesk()">✕</button></div>
        <div class="txd-body" id="txd-body"></div></div>`;
      el.addEventListener('click', e => { if (e.target.id === 'tax-desk') closeTaxDesk(); });
      el.querySelectorAll('.txd-tabs button').forEach(b => b.onclick = () => { deskTab = b.dataset.tab; drawDesk(); });
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
    document.getElementById('txd-body').innerHTML = '<div class="txmuted">Loading rules…</div>';
    loadRules().then(drawDesk);
  }
  function closeTaxDesk() { const el = document.getElementById('tax-desk'); if (el) el.style.display = 'none'; }

  function drawDesk() {
    const body = document.getElementById('txd-body'); if (!body) return;
    document.querySelectorAll('.txd-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === deskTab));
    if (!R) { body.innerHTML = '<div class="txerr">Could not load tax rules from the backend. Check the API URL in Settings.</div>'; return; }
    const st = R.status || {};
    document.getElementById('txd-sub').innerHTML = `TY ${esc(R.meta.tax_year)} · ${esc(R.meta.act.split(' (')[0])} · rules ${esc(R.version)}` +
      (st.pending_updates ? ` · <a href="#" onclick="FluidTax.tab('updates');return false" class="txpend">${st.pending_updates} update${st.pending_updates > 1 ? 's' : ''} pending</a>` : '') +
      (st.unverified ? ` · ${st.unverified} items flagged to verify` : '');
    ({ lookup: drawLookup, structures: drawStructures, dtaa: drawDTAA, eligibility: drawEligibility, planning: drawPlanning, calc: drawCalc, compare: drawCompare,
       harvest: drawHarvest, updates: drawUpdates, sources: drawSources }[deskTab] || drawLookup)(body);
  }

  function assetRow(x) {
    return `<tr><td>${esc(x.label)} ${vbadge(x)}${x.notes ? `<div class="txnote">${x.notes.map(esc).join('<br>')}</div>` : ''}${x.follows ? `<div class="txnote">${esc(x.follows)}</div>` : ''}${x.maturity_exemption ? `<div class="txnote">${esc(x.maturity_exemption)}</div>` : ''}</td>
      <td>${x.exempt_all ? 'Exempt' : x.deemed_stcg ? 'Never (deemed short-term)' : x.flat ? '—' : x.lt_months ? '> ' + x.lt_months + ' months' + (x.lt_months_listed ? ` (listed > ${x.lt_months_listed})` : '') : '—'}</td>
      <td>${x.exempt_all ? 'Exempt' : x.flat ? x.flat + '% flat' : pct(x.stcg)}</td><td>${x.exempt_all ? 'Exempt' : x.ltcg != null ? pct(x.ltcg) + (x.exemption_112A ? ' above ₹1.25L' : '') : x.flat ? x.flat + '% flat' : '—'}</td></tr>`;
  }
  function incomeRow(i) {
    return `<details class="txdet"><summary>${esc(i.label)} — <i>${esc(i.tax.replace(/_/g, ' '))}</i> ${vbadge(i)}</summary>
      ${(i.notes || []).map(n => `<div class="txnote">• ${esc(n)}</div>`).join('')}
      ${i.components ? Object.entries(i.components).map(([k, v]) => `<div class="txnote">• <b>${esc(k.replace(/_/g, ' '))}</b>: ${esc(v)}</div>`).join('') : ''}</details>`;
  }
  function drawLookup(body) {
    const cats = R.categories || ['Other'];
    const n = R.slabs.new_regime, o = R.slabs.old_regime;
    const q = (document.getElementById('txl-q') || {}).value || '';
    const match = x => !q || (x.label + ' ' + (x.notes || []).join(' ')).toLowerCase().includes(q.toLowerCase());
    body.innerHTML = `
      <div class="txform"><input id="txl-q" placeholder="Search instruments… e.g. SGB, ESOP, REIT, NRE" value="${esc(q)}" style="min-width:320px"></div>
      <div class="txd-grid2">
        <section><h4>Capital gains — by instrument</h4>
          ${cats.map(c => { const rows = R.capital_gains.assets.filter(a => (a.cat || 'Other') === c && match(a)); return rows.length ? `
            <div class="txcat">${esc(c)}</div><table class="txt"><thead><tr><th>Instrument</th><th>Long-term after</th><th>STCG</th><th>LTCG</th></tr></thead><tbody>${rows.map(assetRow).join('')}</tbody></table>` : ''; }).join('')}
          <div class="txnote">${esc(R.capital_gains.common.indexation)} ${esc(R.capital_gains.common.land_building_option)} ${esc(R.capital_gains.common.grandfathering_112A)}</div>
        </section>
        <section><h4>Income from instruments (interest, payouts, pensions)</h4>
          ${cats.map(c => { const rows = R.income.filter(i => (i.cat || 'Other') === c && match(i)); return rows.length ? `<div class="txcat">${esc(c)}</div>${rows.map(incomeRow).join('')}` : ''; }).join('')}
          <h4>Slabs — new regime (default)</h4>${slabTable(n.slabs)}
          <div class="txnote">Rebate: resident individuals with income ≤ ${inr(n.rebate.income_limit)} pay nil (max ${inr(n.rebate.max_rebate)}); not on special-rate gains. Standard deduction ${inr(n.standard_deduction.salary)}.</div>
          <h4>Old regime</h4>${slabTable(o.slabs.below_60)}
          <div class="txnote">Senior 60–79: nil to ₹3L; 80+: nil to ₹5L. Rebate ≤ ${inr(o.rebate.income_limit)}. 80C ₹1.5L, 80CCD(1B) ₹50k.</div>
          <h4>Surcharge & cess</h4><div class="txnote">${R.surcharge.individual_like.bands.map(b => `> ${inr(b[0])}: ${b[1]}%`).join(' · ')}. New regime capped at ${R.surcharge.individual_like.new_regime_cap}%. Capital gains & dividends capped at ${R.surcharge.individual_like.special_income_cap}%. Cess ${R.meta.cess_pct}%.</div>
          <h4>Set-off & losses</h4>${R.set_off.rules.map(r => `<div class="txnote">• ${esc(r)}</div>`).join('')}
          <h4>TDS — residents</h4>${tdsTable(R.tds.resident)}<h4>TDS — NRIs</h4>${tdsTable(R.tds.nri)}
          <h4>STT</h4><div class="txnote">Futures ${R.stt.futures.sell}% · options premium ${R.stt.options_premium.sell}% · exercise ${R.stt.options_exercise.rate}% · delivery ${R.stt.equity_delivery.buy}% each side.</div>
        </section>
      </div>
      <div class="txnote" style="margin-top:1rem">${esc(R.meta.disclaimer)}</div>`;
    const qi = document.getElementById('txl-q');
    qi.oninput = () => { const pos = qi.selectionStart; drawLookup(body); const n2 = document.getElementById('txl-q'); n2.focus(); n2.setSelectionRange(pos, pos); };
  }

  function drawStructures(body) {
    const res = R.residency || {};
    const groups = {};
    Object.entries(R.entities).forEach(([k, e]) => (groups[e.group || 'Other'] = groups[e.group || 'Other'] || []).push([k, e]));
    const order = ['Individuals', 'Family structures', 'Trusts', 'Firms & LLPs', 'Companies', 'Foreign investors', 'AOP / BOI / others', 'Charitable', 'Pooled vehicles', 'Other'];
    body.innerHTML = `<div class="txd-grid2">
      <section><h4>Residential status ${vbadge(res)}</h4>
        <div class="txnote"><b>${esc(res.principle || '')}</b></div>
        ${(res.tests || []).map(t => `<div class="txnote">• ${esc(t.rule)}</div>`).join('')}
        <table class="txt"><tbody>${Object.entries(res.statuses || {}).map(([k, v]) => `<tr><td><b>${esc(k)}</b><div class="txnote">${esc(v.label)}</div></td><td>${esc(v.scope)}${v.conditions ? `<div class="txnote">${esc(v.conditions)}</div>` : ''}</td></tr>`).join('')}</tbody></table>
        <h4>Citizenship vs residency</h4>${Object.entries(res.citizenship_types || {}).map(([k, v]) => `<div class="txnote">• <b>${esc(k.replace(/_/g, ' '))}</b>: ${esc(v)}</div>`).join('')}
        <div class="txnote">• ${esc(res.huf_residency || '')}</div><div class="txnote">• ${esc(res.company_residency || '')}</div><div class="txnote">• ${esc(res.firm_aop_residency || '')}</div>
        <h4>MMR</h4><div class="txnote">${esc(R.mmr.description)} TY ${esc(R.meta.tax_year)}: up to ${R.mmr.tax_year_2026_27_max_effective_pct}% (new-regime surcharge cap); ${R.mmr.old_regime_max_effective_pct}% at 37% surcharge.</div>
      </section>
      <section><h4>Every structure</h4>
        ${order.filter(g => groups[g]).map(g => `<div class="txcat">${esc(g)}</div>` + groups[g].map(([k, e]) => `<details class="txdet"><summary>${esc(e.label)} ${vbadge(e)}${e.engine ? '' : ' <span class="txtag">reference</span>'}</summary>
          ${(e.rules || e.notes || []).map(r => `<div class="txnote">• ${esc(r)}</div>`).join('')}
          ${e.options ? e.options.map(op => `<div class="txnote">• ${esc(op.id)}: ${op.rate != null ? op.rate + '%' : 'slabs'}${op.note ? ' — ' + esc(op.note) : ''}</div>`).join('') : ''}
          ${e.mat ? `<div class="txnote">• MAT ${e.mat.rate}%${e.mat.final_tax ? ' (final tax)' : ''}${e.mat.credit ? ' — ' + esc(e.mat.credit) : ''}</div>` : ''}
          ${e.investment_notes ? e.investment_notes.map(r => `<div class="txnote">• ${esc(r)}</div>`).join('') : ''}
          ${e.open_question ? `<div class="txnote txwarn">⚠ ${esc(e.open_question)}</div>` : ''}</details>`).join('')).join('')}
      </section></div>`;
  }

  function drawDTAA(body) {
    const d = R.dtaa; if (!d) { body.innerHTML = '<div class="txmuted">No treaty data.</div>'; return; }
    body.innerHTML = `<div class="txnote"><b>${esc(d.principle)}</b></div>
      <table class="txt"><thead><tr><th>Country</th><th>Dividends (individual pays)</th><th>NRO / other interest</th><th>Gains on Indian shares</th><th>Gains on MF units</th><th>Home-country tax</th></tr></thead><tbody>
      ${d.countries.map(c => `<tr><td><b>${esc(c.name)}</b> ${vbadge(c)}</td>
        <td><b>${c.dividend.individual_effective}%</b><div class="txnote">Treaty: ${esc(c.dividend.treaty)}${c.dividend.note ? '<br>' + esc(c.dividend.note) : ''}</div></td>
        <td><b>${c.interest.nro_effective}%</b><div class="txnote">Treaty: ${esc(c.interest.treaty)}</div></td>
        <td>${esc(c.cg_shares)}</td>
        <td>${c.mf_units_residence_only ? '<span class="txconf txconf-high">possible exemption</span> ' : ''}${esc(c.cg_mf_units)}</td>
        <td>${esc(c.home_tax)}${c.open_question ? `<div class="txnote txwarn">⚠ ${esc(c.open_question)}</div>` : ''}</td></tr>`).join('')}
      </tbody></table>
      <div class="txnote">Act rate without treaty: dividends ${d.act_rates_nonresident.dividend}%, NRO interest ${esc(d.act_rates_nonresident.nro_interest)}. NRE / FCNR interest is exempt for non-residents regardless of treaty.</div>
      <div class="txd-grid2"><section><h4>Documents to claim treaty rates</h4>${d.documents.map(x => `<div class="txnote">• ${esc(x)}</div>`).join('')}
        <h4>Anti-abuse</h4>${d.anti_abuse.map(x => `<div class="txnote">• ${esc(x)}</div>`).join('')}</section>
        <section><h4>Caution</h4>${d.caution.map(x => `<div class="txnote txwarn">• ${esc(x)}</div>`).join('')}
        <div class="txnote">Try it: Calculator → taxpayer NRI → treaty country → tick “MF-unit treaty exemption”.</div></section></div>
      ${homeCountryHTML()}`;
  }
  function homeCountryHTML() {
    const h = R.home_country; if (!h) return '';
    const cs = [['us', 'US person'], ['uk', 'UK resident'], ['canada', 'Canada'], ['australia', 'Australia'], ['uae', 'UAE'], ['singapore', 'Singapore']];
    const badge = r => `<span class="txfit txfit-${r}">${r === 'ok' ? '✓ fine' : r === 'caution' ? '⚠ caution' : '✕ avoid'}</span>`;
    const p = h.us_pfic, u = h.uk_offshore_funds;
    return `<h4>Home-country tax on Indian products ${vbadge(h)}</h4>
      <div class="txnote"><b>${esc(h.principle)}</b></div>
      <table class="txt"><thead><tr><th>Indian product</th>${cs.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
      ${h.products.map(r => `<tr><td><b>${esc(r.product)}</b></td>${cs.map(c => `<td>${badge(r[c[0]][0])}<div class="txnote">${esc(r[c[0]][1])}</div></td>`).join('')}</tr>`).join('')}</tbody></table>
      <div class="txd-grid2"><section><h4>US — PFIC ${vbadge(p)}</h4><div class="txnote">${esc(h.who_is_caught.us)}</div><div class="txnote"><b>${esc(p.what)}</b></div>
        ${p.regimes.map(x => `<div class="txnote">• ${esc(x)}</div>`).join('')}<div class="txnote"><b>Reporting:</b> ${p.reporting.map(esc).join(' · ')}</div>
        <div class="txnote">${esc(p.india_side)}</div></section>
        <section><h4>UK — offshore funds ${vbadge(u)}</h4><div class="txnote">${esc(h.who_is_caught.uk)}</div><div class="txnote"><b>${esc(u.what)}</b></div>
        <div class="txnote">• ${esc(u.effect)}</div><div class="txnote">• ${esc(u.direct_shares)}</div>
        <h4>Canada ${vbadge(h.canada)}</h4><div class="txnote">${esc(h.canada.what)} ${esc(h.canada.effect)}</div>
        <h4>Australia ${vbadge(h.australia)}</h4><div class="txnote">${esc(h.australia.what)} ${esc(h.australia.effect)}</div></section></div>
      <div class="txnote txwarn">${esc(h.caution)}</div>`;
  }

  function drawEligibility(body) {
    const el = R.eligibility || { rows: [] };
    const cols = [['resident', 'Resident individual'], ['nri', 'NRI'], ['oci', 'OCI / PIO'], ['foreign_national_nr', 'Foreign national (NR)'], ['huf', 'HUF'], ['trust', 'Trust'], ['company', 'Company'], ['llp_firm', 'LLP / firm']];
    body.innerHTML = `<div class="txnote">${esc(el.note || '')} ${vbadge(el)}</div>
      <table class="txt"><thead><tr><th>Product</th>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${el.rows.map(r => `<tr><td><b>${esc(r.product)}</b></td>${cols.map(c => `<td>${esc(r[c[0]] || '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function drawPlanning(body) {
    body.innerHTML = `<div class="txd-grid2">${(R.structuring || []).map(p => `<section class="txupd"><b>${esc(p.title)}</b> ${vbadge(p)}
      ${p.points.map(x => `<div class="txnote">• ${esc(x)}</div>`).join('')}</section>`).join('')}</div>
      <div class="txnote">${esc(R.meta.disclaimer)}</div>`;
  }

  function slabTable(s) { return `<table class="txt"><tbody>${s.map(([lo, hi, r]) => `<tr><td>${inr(lo)} – ${hi ? inr(hi) : 'above'}</td><td>${r}%</td></tr>`).join('')}</tbody></table>`; }
  function tdsTable(t) { return `<table class="txt"><tbody>${t.map(x => `<tr><td>${esc(x.item)} ${vbadge(x)}${x.note ? `<div class="txnote">${esc(x.note)}</div>` : ''}</td><td>${pct(x.rate)}${x.threshold ? ' > ' + inr(x.threshold) : ''}</td></tr>`).join('')}</tbody></table>`; }

  // calculator with multiple lines
  function drawCalc(body) {
    body.innerHTML = `<div class="txd-calc">
      <div class="txform txgrid">
        <label>Taxpayer<select id="txc-entity">${entityOptions()}</select></label>
        <label>Regime<select id="txc-regime"><option value="new_regime">New (default)</option><option value="old_regime">Old</option></select></label>
        <label>Age (old regime)<select id="txc-age"><option value="below_60">Below 60</option><option value="senior_60_79">60–79</option><option value="super_senior_80">80+</option></select></label>
        <label>Other income for the year ₹<input type="number" id="txc-income" value="0"></label>
        <label>…of which dividends ₹<input type="number" id="txc-div" value="0"></label>
        <label>Company tax option<select id="txc-coreg"><option value="115BAA">115BAA (22%)</option><option value="normal_small">Normal 25%</option><option value="normal">Normal 30%</option><option value="115BAB">115BAB (15%)</option></select></label>
        <label>Treaty country (non-residents)<select id="txc-dtaa"><option value="">None / Act rates</option>${(R.dtaa ? R.dtaa.countries : []).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
        <label style="flex-direction:row;align-items:center;gap:.35rem"><input type="checkbox" id="txc-mftreaty" style="width:auto"> MF-unit treaty exemption (SG/UAE, tribunal view)</label>
        <label style="flex-direction:row;align-items:center;gap:.35rem"><input type="checkbox" id="txc-usp" style="width:auto"> US person (citizen / green card) — flag PFIC</label>
        <label>Brought-forward losses ST / LT ₹<span style="display:flex;gap:.3rem"><input type="number" id="txc-stcl" placeholder="0"><input type="number" id="txc-ltcl" placeholder="0"></span></label>
      </div>
      <h4>Gains / losses this year</h4>
      <table class="txt" id="txc-lines"><thead><tr><th>Asset</th><th>Bought</th><th>Sold</th><th>Gain (− for loss)</th><th></th></tr></thead><tbody></tbody></table>
      <div class="txform"><button onclick="FluidTax.addLine()">+ Add line</button><button class="txprimary" onclick="FluidTax.runCalc()">Calculate</button></div>
      <div id="txc-out" class="txout"></div></div>`;
    addLine();
  }
  function addLine() {
    const tb = document.querySelector('#txc-lines tbody'); if (!tb) return;
    const today = new Date().toISOString().slice(0, 10);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><select class="l-asset">${assetOptions('equity_mf')}</select>
        <div class="l-extra txnote"><label><input type="checkbox" class="l-orig"> SGB original issue, held to maturity</label>
        <select class="l-sif"><option value="">SIF type…</option><option value="equity">Equity</option><option value="debt">Debt</option><option value="hybrid">Hybrid</option></select>
        <select class="l-promoter"><option value="">Not promoter</option><option value="corporate">Corporate promoter</option><option value="non_corporate">Non-corporate promoter</option></select></div></td>
      <td><input type="date" class="l-buy"></td><td><input type="date" class="l-sell" value="${today}"></td>
      <td><input type="number" class="l-gain" placeholder="₹"></td><td><button onclick="this.closest('tr').remove()">✕</button></td>`;
    const sync = () => { const a = tr.querySelector('.l-asset').value;
      tr.querySelector('.l-orig').parentElement.style.display = a === 'sgb' ? '' : 'none';
      tr.querySelector('.l-sif').style.display = a === 'sif' ? '' : 'none';
      tr.querySelector('.l-promoter').style.display = a === 'buyback' ? '' : 'none'; };
    tr.querySelector('.l-asset').onchange = sync; sync();
    tb.appendChild(tr);
  }
  function collect() {
    const v = id => document.getElementById(id).value;
    const gains = [...document.querySelectorAll('#txc-lines tbody tr')].map(tr => ({
      asset_id: tr.querySelector('.l-asset').value, purchase_date: tr.querySelector('.l-buy').value,
      sale_date: tr.querySelector('.l-sell').value, gain: +tr.querySelector('.l-gain').value || 0,
      original_subscriber: tr.querySelector('.l-orig').checked, held_to_maturity: tr.querySelector('.l-orig').checked,
      sif_class: tr.querySelector('.l-sif').value, promoter: tr.querySelector('.l-promoter').value,
      label: tr.querySelector('.l-asset').selectedOptions[0].textContent,
    })).filter(g => g.purchase_date && g.sale_date);
    return { entity: v('txc-entity'), regime: v('txc-regime'), age_band: v('txc-age'), company_regime: v('txc-coreg'), normal_income: +v('txc-income') || 0,
             dividend_income: +v('txc-div') || 0, dtaa_country: v('txc-dtaa'), apply_mf_treaty: document.getElementById('txc-mftreaty').checked, us_person: document.getElementById('txc-usp').checked, brought_forward: { stcl: +v('txc-stcl') || 0, ltcl: +v('txc-ltcl') || 0 }, gains };
  }
  async function runCalc() {
    const out = document.getElementById('txc-out'); out.innerHTML = '<div class="txmuted">Calculating…</div>';
    try {
      const p = collect(); if (!p.gains.length) throw new Error('Add at least one line with buy and sell dates.');
      const r = await post('/tax/compute', p);
      out.innerHTML = `<table class="txt"><thead><tr><th>Line</th><th>Treatment</th><th>Gain</th></tr></thead><tbody>
        ${r.lines.map(l => `<tr><td>${esc(l.label)}</td><td>${esc(l.reason)}</td><td>${inr(l.gain)}</td></tr>`).join('')}</tbody></table>
        <div class="txd-grid2"><div>
          ${row('Tax caused by these gains', inr(r.tax_on_gains_only))}${row('Total tax for the year', inr(r.tax.total))}
          ${row('Effective rate', r.effective_rate_pct + '%')}${row('Normal tax', inr(r.tax.normal))}${row('Tax on special-rate gains', inr(r.tax.special_cg))}
          ${r.tax.vda ? row('VDA tax', inr(r.tax.vda)) : ''}${r.tax.rebate ? row('Rebate', '− ' + inr(r.tax.rebate)) : ''}
          ${row('Surcharge', inr(r.tax.surcharge) + ` (${r.tax.surcharge_rate}%)`)}${r.tax.marginal_relief ? row('Marginal relief', '− ' + inr(r.tax.marginal_relief)) : ''}${row('Cess', inr(r.tax.cess))}
        </div><div>
          ${row('112A exemption used', inr(r.exemption_112A_used))}${row('Basic exemption used vs gains', inr(r.basic_exemption_used_vs_cg))}
          ${r.exempt_gains ? row('Exempt gains', inr(r.exempt_gains)) : ''}
          ${r.set_off.length ? '<div class="txnote"><b>Set-off:</b> ' + r.set_off.map(s => `${inr(s.amount)} against ${esc(s.against)}`).join('; ') + '</div>' : ''}
          ${(r.carry_forward.stcl || r.carry_forward.ltcl) ? row('Carry forward ST / LT', `${inr(r.carry_forward.stcl)} / ${inr(r.carry_forward.ltcl)}`) : ''}
        </div></div>${r.notes.map(n => `<div class="txnote txwarn">${esc(n)}</div>`).join('')}`;
    } catch (e) { out.innerHTML = `<div class="txerr">${esc(e.message)}</div>`; }
  }

  function drawCompare(body) {
    body.innerHTML = `<div class="txform txgrid">
        <label>Asset<select id="txp-asset">${assetOptions('debt_mf_post_apr2023')}</select></label>
        <label>Gain ₹<input type="number" id="txp-gain" value="1000000"></label>
        <label>Held (months)<input type="number" id="txp-months" value="30"></label>
        <label>Individual's other income ₹<input type="number" id="txp-inc" value="3000000"></label>
        <button class="txprimary" onclick="FluidTax.runCompare()">Compare</button></div>
      <div id="txp-out" class="txout"></div>
      <div class="txnote">Same gain, taxed in different hands. HUF/trust/company are assumed to have no other income unless you change it in the Calculator.</div>`;
  }
  async function runCompare() {
    const out = document.getElementById('txp-out'); out.innerHTML = '<div class="txmuted">Comparing…</div>';
    const g = { asset_id: document.getElementById('txp-asset').value, gain: +document.getElementById('txp-gain').value || 0, ...datesFromMonths(document.getElementById('txp-months').value) };
    const inc = +document.getElementById('txp-inc').value || 0;
    const variants = [
      { entity: 'individual_resident', regime: 'new_regime', normal_income: inc },
      { entity: 'individual_resident', regime: 'old_regime', normal_income: inc },
      { entity: 'individual_nri', normal_income: 0 }, { entity: 'huf', normal_income: 0 },
      { entity: 'individual_rnor', regime: 'new_regime', normal_income: inc }, { entity: 'trust_private_discretionary', normal_income: 0 },
      { entity: 'trust_will_dependent', normal_income: 0 }, { entity: 'llp', normal_income: 0 },
      { entity: 'company_private', company_regime: '115BAA', normal_income: 0 }, { entity: 'company_private', company_regime: 'normal', normal_income: 0 },
      { entity: 'fpi_non_corporate', normal_income: 0 }, { entity: 'aop_indeterminate', normal_income: 0 },
      { entity: 'individual_nri', normal_income: 0, dtaa_country: 'uae', apply_mf_treaty: true, _label: 'NRI in UAE — MF treaty claim' },
      { entity: 'individual_nri', normal_income: 0, dtaa_country: 'singapore', apply_mf_treaty: true, _label: 'NRI in Singapore — MF treaty claim' },
    ];
    try {
      const r = await post('/tax/compare', { base: { gains: [g] }, variants });
      const max = Math.max(1, ...r.results.map(x => x.on_gains || 0));
      out.innerHTML = r.results.map(x => x.error ? `<div class="txerr">${esc(x.error)}</div>` :
        `<div class="txbar"><span class="txbar-l">${esc(x.variant._label || x.label)}${!x.variant._label && x.regime && x.regime.includes('regime') ? ' · ' + x.regime.replace('_regime', '') : ''}</span>
         <span class="txbar-t"><i style="width:${(x.on_gains || 0) / max * 100}%"></i></span><b>${inr(x.on_gains)}</b>
         <span class="txmuted">${g.gain ? ((x.on_gains || 0) / g.gain * 100).toFixed(1) + '%' : ''}</span></div>`).join('');
    } catch (e) { out.innerHTML = `<div class="txerr">${esc(e.message)}</div>`; }
  }

  function drawHarvest(body) {
    body.innerHTML = `<div class="txform txgrid">
        <label>Equity LTCG already booked this tax year ₹<input type="number" id="txv-used" value="0"></label></div>
      <h4>Long-term equity lots (optional)</h4>
      <table class="txt" id="txv-lots"><thead><tr><th>Fund / stock</th><th>Bought</th><th>Current value ₹</th><th>Unrealised gain ₹</th><th></th></tr></thead><tbody></tbody></table>
      <div class="txform"><button onclick="FluidTax.addLot()">+ Add lot</button><button class="txprimary" onclick="FluidTax.runHarvest()">Plan harvest</button></div>
      <div id="txv-out" class="txout"></div>`;
    addLot();
  }
  function addLot() {
    const tb = document.querySelector('#txv-lots tbody'); if (!tb) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input class="v-l" placeholder="e.g. Parag Parikh Flexi Cap"></td><td><input type="date" class="v-d"></td>
      <td><input type="number" class="v-v"></td><td><input type="number" class="v-g"></td><td><button onclick="this.closest('tr').remove()">✕</button></td>`;
    tb.appendChild(tr);
  }
  async function runHarvest() {
    const out = document.getElementById('txv-out');
    const lots = [...document.querySelectorAll('#txv-lots tbody tr')].map(tr => ({ label: tr.querySelector('.v-l').value, purchase_date: tr.querySelector('.v-d').value,
      value: +tr.querySelector('.v-v').value || 0, unrealised_gain: +tr.querySelector('.v-g').value || 0 })).filter(l => l.purchase_date);
    try {
      const r = await post('/tax/harvest', { realised_112A_net: +document.getElementById('txv-used').value || 0, lots });
      out.innerHTML = row('Tax-free headroom left', inr(r.headroom)) + row('Tax saved by harvesting now', inr(r.tax_saved_now)) +
        (r.plan.length ? `<table class="txt"><thead><tr><th>Redeem</th><th>Value to redeem</th><th>Gain booked</th></tr></thead><tbody>${r.plan.map(p => `<tr><td>${esc(p.label)}</td><td>${inr(p.redeem_value)}</td><td>${inr(p.book_gain)}</td></tr>`).join('')}</tbody></table>` : '') +
        `<div class="txnote">${esc(r.note)} Exit loads and STT still apply; ELSS lock-in must be over.</div>`;
    } catch (e) { out.innerHTML = `<div class="txerr">${esc(e.message)}</div>`; }
  }

  async function drawUpdates(body) {
    body.innerHTML = '<div class="txmuted">Loading…</div>';
    let pending = [], runs = [], overlay = { patches: [] };
    try {
      [pending, runs, overlay] = await Promise.all([authed('/tax/updates?status=pending'), authed('/tax/agent/runs'), authed('/tax/overlay')]);
    } catch (e) { body.innerHTML = `<div class="txerr">${esc(e.message)}</div>`; return; }
    const last = runs[0];
    body.innerHTML = `
      <div class="txform" style="justify-content:space-between">
        <div class="txmuted">The update agent checks official sources every Monday (daily 1–10 Feb). Nothing changes in the app until you approve it.
          ${last ? `<br>Last run: ${esc((last.started_at || '').slice(0, 16).replace('T', ' '))} UTC — <b>${esc(last.status)}</b>${last.filed != null ? `, ${last.filed} proposals` : ''}${last.error ? ' · ' + esc(last.error) : ''}` : '<br>No runs yet.'}</div>
        <div><button onclick="FluidTax.runAgent('all')">Check now</button> <button onclick="FluidTax.runAgent('verify')">Verify flagged items</button></div></div>
      <h4>Pending (${pending.length})</h4>
      ${pending.length ? pending.map(u => `<div class="txupd" data-id="${esc(u.id)}">
          <div class="txupd-h"><span class="txconf txconf-${esc(u.confidence)}">${esc(u.confidence)}</span> <span class="txtag">${esc(u.change_type)}</span> <b>${esc(u.summary)}</b></div>
          <div class="txnote"><code>${esc(u.path)}</code>${u.effective_from ? ' · effective ' + esc(u.effective_from) : ''}</div>
          <div class="txd-grid2"><div><div class="txmuted">Current</div><pre>${esc(JSON.stringify(u.current_value, null, 1))}</pre></div>
            <div><div class="txmuted">Proposed (editable)</div><textarea class="txupd-v">${esc(JSON.stringify(u.proposed_value, null, 1))}</textarea></div></div>
          ${(u.sources || []).map(s => `<div class="txnote">↗ <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, '').slice(0, 70))}</a> <span class="txtag">${esc(s.tier)}</span>${s.quote ? `<br><i>“${esc(s.quote)}”</i>` : ''}</div>`).join('')}
          <div class="txform"><button class="txprimary" onclick="FluidTax.decide('${esc(u.id)}','approve')">Approve & apply</button>
            <button onclick="FluidTax.decide('${esc(u.id)}','reject')">Reject</button></div></div>`).join('') : '<div class="txmuted">Nothing waiting for review.</div>'}
      <h4>Applied changes (${(overlay.patches || []).length})</h4>
      ${(overlay.patches || []).map((p, i) => `<div class="txnote">• <b>${esc(p.summary || p.path)}</b> — <code>${esc(p.path)}</code> = ${esc(JSON.stringify(p.value))} <span class="txmuted">(${esc((p.approved_at || '').slice(0, 10))})</span>
          <button onclick="FluidTax.revert(${i})">Undo</button></div>`).join('') || '<div class="txmuted">None — the app is running on the base ruleset.</div>'}`;
  }
  async function decide(id, action) {
    const card = document.querySelector(`.txupd[data-id="${id}"]`);
    let value;
    if (action === 'approve') {
      try { value = JSON.parse(card.querySelector('.txupd-v').value); } catch (_) { alert('Proposed value is not valid JSON'); return; }
    }
    try { await authed(`/tax/updates/${id}/${action}`, { method: 'POST', body: JSON.stringify({ value, note: '' }) }); await loadRules(true); drawDesk(); }
    catch (e) { alert(e.message); }
  }
  async function revert(i) {
    if (!confirm('Undo this applied change?')) return;
    try { await authed(`/tax/overlay/${i}`, { method: 'DELETE' }); await loadRules(true); drawDesk(); } catch (e) { alert(e.message); }
  }
  async function runAgent(mode) {
    try { const r = await authed(`/tax/agent/run?mode=${mode}`, { method: 'POST' });
      alert(r.status === 'already_running' ? 'A check is already running.' : 'Check started. Proposals appear here in a few minutes.'); drawDesk(); }
    catch (e) { alert(e.message); }
  }

  function drawSources(body) {
    body.innerHTML = `<div class="txnote">${esc(R.meta.transition_note)}</div>
      <ul class="txul">${Object.entries(R.sources).map(([k, s]) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> <span class="txmuted">[${esc(k)}]</span></li>`).join('')}</ul>`;
  }

  // ------------------------------------------------------------------ styles
  const css = document.createElement('style');
  css.textContent = `
  .txr{display:flex;justify-content:space-between;gap:.6rem;padding:.28rem 0;border-bottom:1px dashed var(--f-rule,#e2e5ea);font-size:.68rem}
  .txr span{color:var(--f-paper-dim,#555)} .txr b{text-align:right;font-weight:600}
  .txmuted{color:var(--f-paper-faint,#888);font-size:.64rem} .txnote{font-size:.63rem;color:var(--f-paper-dim,#555);margin:.25rem 0;line-height:1.45}
  .txwarn{color:#b45309} .txerr{color:#c0392b;font-size:.66rem;margin:.4rem 0}
  .txfoot{margin-top:.55rem;font-size:.58rem;color:var(--f-paper-faint,#999)} .txfoot a{color:var(--f-info,#2563eb)}
  .txv{font-size:.52rem;padding:1px 5px;border-radius:3px;margin-left:.3rem;vertical-align:middle;text-transform:uppercase;letter-spacing:.04em}
  .txv-u{background:#fef3c7;color:#92400e}
  .txform{display:flex;gap:.4rem;flex-wrap:wrap;align-items:flex-end;margin:.4rem 0}
  .txform input,.txform select,#txc-lines input,#txc-lines select,#txv-lots input{font:inherit;font-size:.66rem;padding:.32rem .45rem;border:1px solid var(--f-rule,#d8dce3);border-radius:5px;background:var(--f-surface,#fff);color:inherit;min-width:0}
  .txform button,.txd-panel button{font:inherit;font-size:.64rem;padding:.34rem .7rem;border:1px solid var(--f-rule,#d8dce3);border-radius:5px;background:var(--f-surface,#fff);cursor:pointer;color:inherit}
  .txprimary{background:#1a2942!important;color:#fff!important;border-color:#1a2942!important}
  .txgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))} .txgrid label{display:flex;flex-direction:column;gap:.2rem;font-size:.6rem;color:var(--f-paper-dim,#555)}
  .txout{margin-top:.4rem} .txres{border-top:1px solid var(--f-rule,#e2e5ea);padding-top:.35rem}
  .txul{margin:.2rem 0 0 1rem;padding:0;font-size:.64rem;line-height:1.5}
  #tax-desk{position:fixed;inset:0;background:rgba(10,15,25,.45);z-index:9999;display:none;align-items:stretch;justify-content:center;padding:2.5vh 2vw}
  .txd-panel{background:var(--f-ink,#f6f7f9);width:min(1200px,100%);border-radius:10px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25);font-family:Inter,system-ui,sans-serif;color:var(--f-paper,#1d2330)}
  .txd-head{display:flex;align-items:center;gap:1rem;padding:.8rem 1.1rem;border-bottom:1px solid var(--f-rule,#e2e5ea);background:var(--f-surface,#fff);flex-wrap:wrap}
  .txd-title{font-weight:700;font-size:.95rem} .txd-sub{font-size:.6rem;color:var(--f-paper-faint,#888)} .txpend{color:#b45309;font-weight:600}
  .txd-tabs{display:flex;gap:.25rem;margin-left:auto;flex-wrap:wrap} .txd-tabs button.on{background:#1a2942;color:#fff;border-color:#1a2942}
  .txd-x{border:none!important;background:none!important;font-size:.9rem!important}
  .txd-body{overflow:auto;padding:1rem 1.1rem;font-size:.68rem}
  .txd-body h4{font-size:.7rem;margin:1rem 0 .4rem;text-transform:uppercase;letter-spacing:.05em;color:var(--f-paper-dim,#555)}
  .txd-grid2{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem} @media(max-width:860px){.txd-grid2{grid-template-columns:1fr}}
  .txt{width:100%;border-collapse:collapse;font-size:.64rem;background:var(--f-surface,#fff)} .txt th,.txt td{border-bottom:1px solid var(--f-rule,#e8ebef);padding:.35rem .45rem;text-align:left;vertical-align:top}
  .txt th{font-weight:600;color:var(--f-paper-dim,#555);background:var(--f-surface-hi,#f1f3f6)}
  .txdet{background:var(--f-surface,#fff);border:1px solid var(--f-rule,#e8ebef);border-radius:6px;padding:.35rem .55rem;margin:.3rem 0} .txdet summary{cursor:pointer;font-weight:600;font-size:.65rem}
  .txbar{display:grid;grid-template-columns:230px 1fr 90px 50px;gap:.6rem;align-items:center;margin:.35rem 0}
  .txbar-t{height:10px;background:var(--f-surface-hi,#eef0f3);border-radius:5px;overflow:hidden;display:block} .txbar-t i{display:block;height:100%;background:#1a2942}
  .txupd{background:var(--f-surface,#fff);border:1px solid var(--f-rule,#e2e5ea);border-radius:8px;padding:.7rem;margin:.5rem 0}
  .txupd pre,.txupd textarea{font:.6rem/1.4 ui-monospace,monospace;background:var(--f-surface-hi,#f4f5f7);border:1px solid var(--f-rule,#e2e5ea);border-radius:5px;padding:.4rem;width:100%;min-height:70px;white-space:pre-wrap;box-sizing:border-box}
  .txtag{font-size:.55rem;padding:1px 6px;border-radius:3px;background:var(--f-surface-hi,#eef0f3);text-transform:uppercase}
  .txconf{font-size:.55rem;padding:1px 6px;border-radius:3px;text-transform:uppercase;font-weight:700}
  .txfit{font-size:.56rem;font-weight:700;padding:1px 6px;border-radius:3px;white-space:nowrap}
  .txfit-ok{background:#dcfce7;color:#166534} .txfit-caution{background:#fef3c7;color:#92400e} .txfit-avoid{background:#fee2e2;color:#991b1b}
  .txcat{font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#B8860B;margin:.8rem 0 .3rem}
  .txconf-high{background:#dcfce7;color:#166534} .txconf-medium{background:#fef3c7;color:#92400e} .txconf-low{background:#fee2e2;color:#991b1b}
  `;
  document.head.appendChild(css);

  // ------------------------------------------------------------------ public
  window.openTaxDesk = openTaxDesk;
  window.closeTaxDesk = closeTaxDesk;
  window.FluidTax = { loadRules, quickCalc, quickHarvest, addLine, runCalc, runCompare, addLot, runHarvest, decide, revert, runAgent,
                      tab: t => { deskTab = t; drawDesk(); }, rules: () => R };

  if (!install()) document.addEventListener('DOMContentLoaded', install);
})();
