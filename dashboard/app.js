// Buggy Radar — the Token Launch Radar page's whole logic. Everything it draws comes from window.RADAR,
// the data file the program writes beside this page: the ranked board, the live tokens, the
// set-asides, the group ratios and the model constants. No fetch, no network, no state that a
// reload would change. The URL hash carries the view and the filters (#view=live, #q=lend,
// #cat=Lending, #growth=hot, #src=wl, #sort=tvl, #p=<slug> opens a protocol), so any state of
// the page can be linked — or screenshotted. Every column header sorts; every filter composes.
'use strict';

const R = window.RADAR;
const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const $ = (s) => document.querySelector(s);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Money, compact: $250.1M, $1.14B, $95K — the board's own figures, one decimal where it helps. */
function money(n) {
  if (n === null || n === undefined) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
}

/** Money in full, for the detail view's workings. */
const moneyFull = (n) => (n === null || n === undefined ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);

/** A signed percentage, coloured by the caller. */
const pct = (n) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);

/** A ratio as the market quotes it: 0.17×. */
const ratioText = (n) => (n === null || n === undefined ? '—' : `${n.toFixed(2)}×`);

/** Days tracked, in the words a reader ages a protocol by. */
function ageText(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days < 90) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30.4)} mo`;
  return `${(days / 365.25).toFixed(1)} yrs`;
}

/** The richest ratio the model allows at a TVL, recomputed from the shipped constants. */
function sizeCap(tvl) {
  const m = R.model;
  if (tvl >= m.size_cap_big_tvl) return m.size_cap_big;
  if (tvl >= m.size_cap_mid_tvl) return m.size_cap_mid;
  return m.ratio_clip_high;
}

// ------------------------------------------------------------ state

const state = {
  view: 'board', q: '', cat: '', chain: '', band: '', growth: '', agef: '', src: '', tier: '', preset: '',
  sortKey: 'rank', sortAsc: true, slug: null, cmpA: null, cmpB: null, chart: false,
};

/** A protocol's conviction tier, from its record alone: the scale it holds and the time it has held it. */
function tierOf(r) {
  if (r.tvl_usd >= 100_000_000 && r.age_days !== null && r.age_days >= 365) return 'core';
  if (r.tvl_usd >= 25_000_000 && r.age_days !== null && r.age_days >= 180) return 'building';
  return 'early';
}
const TIER_LABEL = { core: 'Proven scale', building: 'Building', early: 'Early' };

/** Each sortable column's natural direction: rank and name read ascending, the rest descending. */
const SORT_ASC_DEFAULT = { rank: true, name: true, tvl: false, change: false, age: false, ratio: false, implied: false };

function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('view')) state.view = h.get('view');
  if (h.get('q') !== null) state.q = h.get('q') || '';
  if (h.get('cat') !== null) state.cat = h.get('cat') || '';
  if (h.get('chain') !== null) state.chain = h.get('chain') || '';
  if (h.get('growth') !== null) state.growth = h.get('growth') || '';
  if (h.get('agef') !== null) state.agef = h.get('agef') || '';
  if (h.get('src') !== null) state.src = h.get('src') || '';
  if (h.get('tier') !== null) state.tier = h.get('tier') || '';
  if (h.get('preset') !== null) state.preset = h.get('preset') || '';
  if (h.get('a')) state.cmpA = h.get('a');
  if (h.get('b')) state.cmpB = h.get('b');
  if (h.get('wl') === '1') state.src = 'wl';
  if (h.get('sort') && h.get('sort') in SORT_ASC_DEFAULT) {
    state.sortKey = h.get('sort');
    state.sortAsc = SORT_ASC_DEFAULT[state.sortKey];
  }
  if (h.get('p')) state.slug = h.get('p');
  if (h.has('chart')) state.chart = true;
}

// ------------------------------------------------------------ header and formula strip

function renderMeta() {
  $('#meta').innerHTML =
    `Snapshot <strong>${esc(R.as_of)}</strong> · DefiLlama, sealed<br>` +
    `<strong>${R.board_size + R.set_aside_size + R.live_size}</strong> protocols scanned · floor ${money(R.floor_usd)} TVL`;
}

function renderFormula() {
  const comps = R.groups.reduce((n, g) => n + g.comparables, 0);
  const sumTvl = rows.reduce((n, r) => n + r.tvl_usd, 0);
  const sumImplied = rows.reduce((n, r) => n + r.implied_value_usd, 0);
  const median = rows[Math.floor(rows.length / 2)];
  $('#formula').innerHTML =
    `<span class="eq">implied value = TVL × group ratio × growth × vintage</span>` +
    `<span class="stat"><strong>${R.board_size}</strong> pre-token protocols ranked</span>` +
    `<span class="stat">watchlist <strong>${R.watchlist_size}/${R.watchlist_size}</strong></span>` +
    `<span class="stat">board TVL <strong>${money(sumTvl)}</strong></span>` +
    `<span class="stat">aggregate implied value <strong>${money(sumImplied)}</strong></span>` +
    `<span class="stat">median implied <strong>${money(median.implied_value_usd)}</strong></span>` +
    `<span class="stat"><strong>${comps}</strong> tokenised comparables</span>` +
    `<span class="stat"><strong>${R.set_aside_size}</strong> products set aside</span>` +
    `<span>model ${esc(R.model_version)} — the Method tab shows every constant</span>`;
}

// ------------------------------------------------------------ the board

function fillSelects() {
  const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
  $('#cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
  const chains = [...new Set(rows.flatMap((r) => r.chains))].sort();
  $('#chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => `<option>${esc(c)}</option>`).join('');
  $('#cat').value = state.cat;
  $('#chain').value = state.chain;
  $('#q').value = state.q;
  $('#growth').value = state.growth;
  $('#agef').value = state.agef;
  $('#src').value = state.src;
  $('#tier').value = state.tier;
}

/** One row against the active farm preset: a capital ceiling, a short hold, or proven scale. */
function presetOk(r) {
  switch (state.preset) {
    case 'cap100': return r.plan && r.plan.capital_usd <= 100;
    case 'cap150': return r.plan && r.plan.capital_usd <= 150;
    case 'short': return r.plan && r.plan.hold_days <= 30;
    case 'core': return tierOf(r) === 'core';
    default: return true;
  }
}

/** One row against the momentum filter: growth sign and size, or the change the record omits. */
function growthOk(r) {
  const c = r.change_7d;
  switch (state.growth) {
    case 'up': return c !== null && c > 0;
    case 'down': return c !== null && c < 0;
    case 'hot': return c !== null && c >= 10;
    case 'cold': return c !== null && c <= -10;
    case 'na': return c === null;
    default: return true;
  }
}

/** One row against the age filter: under six months, six to twenty-four, over two years, unrecorded. */
function ageOk(r) {
  const a = r.age_days;
  switch (state.agef) {
    case 'young': return a !== null && a < 183;
    case 'mid': return a !== null && a >= 183 && a <= 730;
    case 'old': return a !== null && a > 730;
    case 'na': return a === null;
    default: return true;
  }
}

/** The value a column sorts by; nulls (an unreported change, an unrecorded age) always sort last. */
function sortValue(r, key) {
  switch (key) {
    case 'rank': return r.rank;
    case 'name': return r.name.toLowerCase();
    case 'tvl': return r.tvl_usd;
    case 'change': return r.change_7d;
    case 'age': return r.age_days;
    case 'ratio': return r.model.ratio;
    case 'implied': return r.implied_value_usd;
    default: return r.rank;
  }
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (state.src === 'wl' && !r.watchlist) return false;
    if (state.src === 'finds' && r.watchlist) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    if (state.band && r.tvl_usd < Number(state.band)) return false;
    if (state.tier && tierOf(r) !== state.tier) return false;
    if (!growthOk(r) || !ageOk(r) || !presetOk(r)) return false;
    if (q) {
      const hay = `${r.name} ${r.category || ''} ${r.chains.join(' ')} ${r.group}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const key = state.sortKey;
  const dir = state.sortAsc ? 1 : -1;
  return out.sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return a.rank - b.rank;
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === 'string' ? (va < vb ? -1 : va > vb ? 1 : 0) : va - vb;
    return cmp * dir || a.rank - b.rank;
  });
}

/** The band bar's scale: log dollars across the whole board, so every row's bar is comparable. */
const LOG_MIN = Math.log(Math.min(...rows.map((r) => r.implied_low_usd)));
const LOG_MAX = Math.log(Math.max(...rows.map((r) => r.implied_high_usd)));
const logPos = (v) => ((Math.log(Math.max(v, 1)) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * 100;

function renderBoard() {
  const out = visibleRows();
  $('#count').textContent = `${out.length} of ${rows.length} shown`;
  document.querySelectorAll('#board th.sortable').forEach((th) => {
    const on = th.dataset.sort === state.sortKey;
    th.querySelector('.arr').textContent = on ? (state.sortAsc ? '↑' : '↓') : '';
    th.setAttribute('aria-sort', on ? (state.sortAsc ? 'ascending' : 'descending') : 'none');
  });
  $('#board tbody').innerHTML = out
    .map((r) => {
      const chg = r.change_7d === null ? 'flat' : r.change_7d > 0 ? 'up' : r.change_7d < 0 ? 'down' : 'flat';
      const left = logPos(r.implied_low_usd);
      const width = Math.max(1.5, logPos(r.implied_high_usd) - left);
      return (
        `<tr data-slug="${esc(r.slug)}">` +
        `<td class="num rank">${r.rank}</td>` +
        `<td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">Watchlist</span>' : ''}<span class="tier t-${tierOf(r)}">${TIER_LABEL[tierOf(r)]}</span>` +
        `<div class="psub">${esc(r.category || 'Uncategorised')} · ${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</div></td>` +
        `<td class="num">${money(r.tvl_usd)}</td>` +
        `<td class="num ${chg}">${pct(r.change_7d)}</td>` +
        `<td class="num">${ageText(r.age_days)}</td>` +
        `<td class="num">${ratioText(r.model.ratio)}</td>` +
        `<td class="bandcell"><span class="bandval">${money(r.implied_value_usd)}</span>` +
        `<span class="bandrange">${money(r.implied_low_usd)} – ${money(r.implied_high_usd)}</span>` +
        `<div class="band"><span class="range" style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></span>` +
        `<span class="dot" style="left:${logPos(r.implied_value_usd).toFixed(1)}%"></span></div></td></tr>`
      );
    })
    .join('');
}

// ------------------------------------------------------------ the model chart

/** The comparables this page ships, merged: the largest tokenised protocols by market cap and
 *  each group's richest examples — every point the scatter can honestly plot. */
function comparablePoints() {
  const seen = new Map();
  const add = (name, tvl, mcap) => {
    if (!(tvl > 0) || !(mcap > 0)) return;
    const key = `${name}|${tvl}`;
    if (!seen.has(key)) seen.set(key, { name, tvl_usd: tvl, mcap_usd: mcap });
  };
  for (const p of R.live) add(p.name, p.tvl_usd, p.mcap_usd);
  for (const list of Object.values(R.comparables)) for (const c of list) add(c.name, c.tvl_usd, c.mcap_usd);
  return [...seen.values()];
}

const pctile = (sorted, p) => {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo);
};

/** The scatter's shared inputs, computed once from the shipped data: the comparables, their
 *  clipped ratios' median and quartiles, and the log ranges of both axes. The Method tab's
 *  full chart and the detail view's compact chart draw the same picture from these numbers. */
function scatterStats() {
  const comps = comparablePoints();
  const ratios = comps
    .map((c) => Math.min(R.model.ratio_clip_high, Math.max(R.model.ratio_clip_low, c.mcap_usd / c.tvl_usd)))
    .sort((a, b) => a - b);
  const xs = [...comps.map((c) => c.tvl_usd), ...rows.map((r) => r.tvl_usd)];
  const ys = [...comps.map((c) => c.mcap_usd), ...rows.map((r) => r.implied_value_usd)];
  return {
    comps,
    med: pctile(ratios, 0.5),
    p25: pctile(ratios, 0.25),
    p75: pctile(ratios, 0.75),
    x0: Math.log10(Math.min(...xs)),
    x1: Math.log10(Math.max(...xs)),
    y0: Math.log10(Math.min(...ys)),
    y1: Math.log10(Math.max(...ys)),
  };
}

/** The scatter: the comparables' real market caps against TVL on log axes, the median comparable
 *  ratio drawn as a line inside its 25th–75th percentile band, and the board's implied values
 *  over the same axes — the model, seen against the evidence it is read from. */
function renderScatter() {
  const { comps, med, p25, p75, x0, x1, y0, y1 } = scatterStats();
  const W = 660, H = 318, L = 64, B = 30, T = 10, Rt = 12;
  const X = (v) => L + ((Math.log10(v) - x0) / (x1 - x0)) * (W - L - Rt);
  const Y = (v) => H - B - ((Math.log10(v) - y0) / (y1 - y0)) * (H - B - T);
  const Yc = (v) => Math.max(T, Math.min(H - B, Y(v)));
  let grid = '';
  for (let e = Math.ceil(x0); e <= x1; e++)
    grid += `<line class="grid" x1="${X(10 ** e)}" y1="${T}" x2="${X(10 ** e)}" y2="${H - B}"/><text class="axislab" x="${X(10 ** e) + 3}" y="${H - B + 16}">${money(10 ** e)}</text>`;
  for (let e = Math.ceil(y0); e <= y1; e++)
    grid += `<line class="grid" x1="${L}" y1="${Y(10 ** e)}" x2="${W - Rt}" y2="${Y(10 ** e)}"/><text class="axislab" x="${L - 5}" y="${Y(10 ** e) + 3}" text-anchor="end">${money(10 ** e)}</text>`;
  const xa = 10 ** x0;
  const xb = 10 ** x1;
  const band =
    `<polygon class="bandpoly" points="${X(xa)},${Yc(xa * p75)} ${X(xb)},${Yc(xb * p75)} ${X(xb)},${Yc(xb * p25)} ${X(xa)},${Yc(xa * p25)}"/>` +
    `<line class="medline" x1="${X(xa)}" y1="${Yc(xa * med)}" x2="${X(xb)}" y2="${Yc(xb * med)}"/>`;
  const dots = comps
    .map((c) => `<circle class="compdot" cx="${X(c.tvl_usd).toFixed(1)}" cy="${Y(c.mcap_usd).toFixed(1)}" r="3.2"><title>${esc(c.name)} — TVL ${money(c.tvl_usd)}, cap ${money(c.mcap_usd)}</title></circle>`)
    .join('');
  const marks = rows
    .map((r) => `<circle class="boarddot" cx="${X(r.tvl_usd).toFixed(1)}" cy="${Y(r.implied_value_usd).toFixed(1)}" r="2.6"><title>${esc(r.name)} — TVL ${money(r.tvl_usd)}, implied ${money(r.implied_value_usd)}</title></circle>`)
    .join('');
  $('#scatter').innerHTML =
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of value against TVL">${grid}${band}${dots}${marks}` +
    `<text class="axistitle" x="${L}" y="${H - 2}">TVL →</text><text class="axistitle" x="2" y="${T + 8}">value →</text></svg>`;
  $('#chartnote').textContent =
    `${comps.length} tokenised comparables plotted — the largest by market cap and each group's richest examples, every one this page ships. ` +
    `Their median cap-to-TVL ratio, clipped as the model clips it, is ${ratioText(med)}; the board's ${rows.length} implied values sit over the same axes.`;
}

/** The detail view's compact chart: the Method tab's scatter at side-panel size — the same
 *  comparables, the same board values, the same median line in its percentile band — with the
 *  open protocol ringed and named, so selecting a row shows where it sits against the evidence. */
function miniScatter(r) {
  const { comps, med, p25, p75, x0, x1, y0, y1 } = scatterStats();
  const W = 472, H = 272, L = 50, B = 24, T = 8, Rt = 8;
  const X = (v) => L + ((Math.log10(v) - x0) / (x1 - x0)) * (W - L - Rt);
  const Y = (v) => H - B - ((Math.log10(v) - y0) / (y1 - y0)) * (H - B - T);
  const Yc = (v) => Math.max(T, Math.min(H - B, Y(v)));
  let grid = '';
  for (let e = Math.ceil(x0); e <= x1; e++)
    grid += `<line class="grid" x1="${X(10 ** e)}" y1="${T}" x2="${X(10 ** e)}" y2="${H - B}"/><text class="axislab" x="${X(10 ** e) + 3}" y="${H - B + 15}">${money(10 ** e)}</text>`;
  for (let e = Math.ceil(y0); e <= y1; e++)
    grid += `<line class="grid" x1="${L}" y1="${Y(10 ** e)}" x2="${W - Rt}" y2="${Y(10 ** e)}"/><text class="axislab" x="${L - 4}" y="${Y(10 ** e) + 3}" text-anchor="end">${money(10 ** e)}</text>`;
  const xa = 10 ** x0;
  const xb = 10 ** x1;
  const band =
    `<polygon class="bandpoly" points="${X(xa)},${Yc(xa * p75)} ${X(xb)},${Yc(xb * p75)} ${X(xb)},${Yc(xb * p25)} ${X(xa)},${Yc(xa * p25)}"/>` +
    `<line class="medline" x1="${X(xa)}" y1="${Yc(xa * med)}" x2="${X(xb)}" y2="${Yc(xb * med)}"/>`;
  const dots = comps
    .map((c) => `<circle class="compdot" cx="${X(c.tvl_usd).toFixed(1)}" cy="${Y(c.mcap_usd).toFixed(1)}" r="2.4"><title>${esc(c.name)} — TVL ${money(c.tvl_usd)}, cap ${money(c.mcap_usd)}</title></circle>`)
    .join('');
  const marks = rows
    .filter((o) => o.slug !== r.slug)
    .map((o) => `<circle class="boarddot" cx="${X(o.tvl_usd).toFixed(1)}" cy="${Y(o.implied_value_usd).toFixed(1)}" r="1.9"><title>${esc(o.name)} — TVL ${money(o.tvl_usd)}, implied ${money(o.implied_value_usd)}</title></circle>`)
    .join('');
  const sx = X(r.tvl_usd);
  const sy = Y(r.implied_value_usd);
  const anchorEnd = sx > W * 0.6;
  const sel =
    `<circle class="selhalo" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9"/>` +
    `<circle class="seldot" cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="4"/>` +
    `<text class="sellabel" x="${(anchorEnd ? sx - 12 : sx + 12).toFixed(1)}" y="${(sy < 34 ? sy + 20 : sy - 13).toFixed(1)}" text-anchor="${anchorEnd ? 'end' : 'start'}">${esc(r.name)}</text>`;
  return (
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Value against TVL, with ${esc(r.name)} highlighted">${grid}${band}${dots}${marks}${sel}` +
    `<text class="axistitle" x="${L}" y="${H - 2}">TVL →</text><text class="axistitle" x="2" y="${T + 8}">value →</text></svg>`
  );
}

// ------------------------------------------------------------ detail view

function whyText(r) {
  const stat = R.groups.find((g) => g.group === r.group);
  const cap = sizeCap(r.tvl_usd);
  const capped = stat && r.model.ratio >= cap - 1e-9 && stat.median > cap;
  const parts = [
    `${r.name} ranks #${r.rank} of ${R.board_size}. The snapshot records ${moneyFull(r.tvl_usd)} of TVL across ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'} and no token — neither a CoinGecko id nor a symbol.`,
    `Its group, ${r.group}, trades at a median of ${ratioText(stat ? stat.median : null)} of TVL across ${stat ? stat.comparables : 0} tokenised protocols in this snapshot` +
      (capped
        ? `; the size cap then holds the ratio used to ${ratioText(cap)}, because no tokenised protocol at this TVL trades richer than that in the snapshot.`
        : `, and that median is the ratio used.`),
    `A seven-day TVL change of ${pct(r.change_7d)} scales the value by ${r.model.growth_factor.toFixed(2)}, and ${r.age_days === null ? 'an unrecorded listing date' : `${r.age_days} days tracked with no token`} scales it by ${r.model.vintage_factor.toFixed(2)}.`,
    `The band runs the same formula at the group's 25th and 75th percentile ratios: launches like this one have captured between ${money(r.implied_low_usd)} and ${money(r.implied_high_usd)} of value at this TVL.`,
  ];
  return parts.join(' ');
}

function openDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) return;
  state.slug = slug;
  const stat = R.groups.find((g) => g.group === r.group);
  const comps = (R.comparables[r.group] || [])
    .map(
      (c) =>
        `<li><span>${esc(c.name)}</span><span class="cr">TVL ${money(c.tvl_usd)} · cap ${money(c.mcap_usd)} · ${ratioText(c.ratio)}</span></li>`,
    )
    .join('');
  const source = r.watchlist
    ? 'on the snapshot watchlist'
    : `radar find — surfaced by the eligibility scan, not on the house watchlist${r.tvl_usd < R.floor_usd ? `; below the ${money(R.floor_usd)} watchlist floor` : ''}`;
  const steps = (r.farm_detail || r.farm_steps.map((s) => ({ text: s })))
    .map(
      (s) =>
        `<li><div>${esc(s.text)}</div>` +
        (s.cost ? `<div class="stepmeta">Cost: ${esc(s.cost)} · Time: ${esc(s.time)}</div>` : '') +
        `</li>`,
    )
    .join('');
  $('#drawer').innerHTML =
    `<button type="button" class="closebtn" id="close" aria-label="Close">×</button>` +
    `<h2>${esc(r.name)}</h2>` +
    `<p class="dsub">#${r.rank} of ${R.board_size} · ${esc(r.category || 'Uncategorised')} · group: ${esc(r.group)} · conviction: ${TIER_LABEL[tierOf(r)]} · ${esc(source)}</p>` +
    `<div class="figs">` +
    `<div class="fig"><div class="k">Implied value</div><div class="v">${money(r.implied_value_usd)}</div></div>` +
    `<div class="fig"><div class="k">Band</div><div class="v">${money(r.implied_low_usd)}–${money(r.implied_high_usd)}</div></div>` +
    `<div class="fig"><div class="k">TVL</div><div class="v">${money(r.tvl_usd)}</div></div>` +
    `<div class="fig"><div class="k">7d change</div><div class="v">${pct(r.change_7d)}</div></div>` +
    `<div class="fig"><div class="k">Tracked since</div><div class="v">${esc(r.listed_at || 'unknown')}</div></div>` +
    `<div class="fig"><div class="k">Token recorded</div><div class="v">none</div></div>` +
    `</div>` +
    `<div class="dband"><span class="range" style="left:${logPos(r.implied_low_usd).toFixed(1)}%;width:${Math.max(1.5, logPos(r.implied_high_usd) - logPos(r.implied_low_usd)).toFixed(1)}%"></span>` +
    `<span class="dot" style="left:${logPos(r.implied_value_usd).toFixed(1)}%"></span></div>` +
    `<div class="dbandlab"><span>band low ${money(r.implied_low_usd)}</span><span>implied ${money(r.implied_value_usd)}</span><span>band high ${money(r.implied_high_usd)}</span></div>` +
    `<h3>Where it sits — value against TVL</h3>` +
    `<div class="minichart">${miniScatter(r)}</div>` +
    `<p class="minicap">The ringed point is ${esc(r.name)} — TVL ${money(r.tvl_usd)}, implied ${money(r.implied_value_usd)}. Blue points are the tokenised comparables at their real market caps, green the board's implied values; the dashed line is the comparables' median ratio inside its 25th–75th percentile band. The full-size chart is on the Method tab.</p>` +
    `<h3>Why it ranks here</h3><p>${esc(whyText(r))}</p>` +
    `<h3>The workings</h3><table class="calc">` +
    `<tr><td>TVL in the snapshot</td><td>${moneyFull(r.tvl_usd)}</td></tr>` +
    `<tr><td>× group ratio — ${esc(r.group)} median, ${stat ? stat.comparables : 0} comparables</td><td>${ratioText(r.model.ratio)}</td></tr>` +
    `<tr><td>× growth — 7d TVL ${pct(r.change_7d)}</td><td>${r.model.growth_factor.toFixed(2)}</td></tr>` +
    `<tr><td>× vintage — ${r.age_days === null ? 'age unrecorded' : `${r.age_days} days, no token`}</td><td>${r.model.vintage_factor.toFixed(2)}</td></tr>` +
    `<tr class="total"><td>Implied launch value</td><td>${moneyFull(r.implied_value_usd)}</td></tr>` +
    `<tr><td>Band at the group's 25th – 75th percentile ratios</td><td>${moneyFull(r.implied_low_usd)} – ${moneyFull(r.implied_high_usd)}</td></tr>` +
    `</table>` +
    `<h3>Comparable launches in its group</h3><ul class="comps">${comps}</ul>` +
    `<h3>Risks</h3><ul class="risks">${r.risks.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` +
    `<h3>Farm plan</h3>` +
    (r.plan
      ? `<p class="rollup">The plan in one line: <strong>${moneyFull(r.plan.capital_usd)}</strong> of capital in the position · about <strong>30 minutes</strong> to set up · one weekly round of <strong>10–20 minutes</strong> · held at least <strong>${r.plan.hold_days} days</strong>.</p>`
      : '') +
    `<ol class="steps">${steps}</ol>` +
    `<p class="foot">Chains: ${esc(r.chains.join(', ') || '—')}. Every figure above is the snapshot's or the model's, with its workings shown; nothing here is a price or a promise of a token.</p>`;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  $('#close').addEventListener('click', closeDetail);
  // A deep link can name the section to land on (#p=<slug>&part=farm): the drawer scrolls to it.
  const part = new URLSearchParams(location.hash.replace(/^#/, '')).get('part');
  if (part === 'farm') {
    const el = $('#drawer .steps');
    if (el) el.scrollIntoView();
  }
}

function closeDetail() {
  state.slug = null;
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
}

// ------------------------------------------------------------ the other views

function renderLive() {
  $('#livetable tbody').innerHTML = R.live
    .map(
      (p) =>
        `<tr><td><span class="pname">${esc(p.name)}</span><div class="psub">${esc(p.category || 'Uncategorised')} · ${esc(p.chains.slice(0, 3).join(', '))}</div></td>` +
        `<td>${esc(p.group)}</td>` +
        `<td class="num">${money(p.tvl_usd)}</td><td class="num">${money(p.mcap_usd)}</td>` +
        `<td class="num">${ratioText(p.ratio)}</td>` +
        `<td class="num ${p.change_7d > 0 ? 'up' : p.change_7d < 0 ? 'down' : 'flat'}">${pct(p.change_7d)}</td></tr>`,
    )
    .join('');
}

function renderAside() {
  $('#asidelede').textContent =
    `${R.set_aside_size} protocols record no token but are set aside: each is a wrapped, staked or bridged product of a protocol whose token already trades, or an exchange's own entry — its value already trades under the parent's token, so ranking it would rank the same launch twice. The largest:`;
  $('#asidetable tbody').innerHTML = R.aside
    .map(
      (a) =>
        `<tr><td><span class="pname">${esc(a.name)}</span></td><td>${esc(a.category || '—')}</td>` +
        `<td class="num">${money(a.tvl_usd)}</td><td>${esc(a.reason)}</td></tr>`,
    )
    .join('');
}

// ------------------------------------------------------------ compare

function fillCompare() {
  const opts = rows.map((r) => `<option value="${esc(r.slug)}">#${r.rank} ${esc(r.name)}</option>`).join('');
  $('#cmpa').innerHTML = opts;
  $('#cmpb').innerHTML = opts;
  state.cmpA = state.cmpA && bySlug.has(state.cmpA) ? state.cmpA : rows[0].slug;
  state.cmpB = state.cmpB && bySlug.has(state.cmpB) ? state.cmpB : rows[1].slug;
  $('#cmpa').value = state.cmpA;
  $('#cmpb').value = state.cmpB;
}

function renderCompare() {
  const a = bySlug.get(state.cmpA);
  const b = bySlug.get(state.cmpB);
  if (!a || !b) return;
  const line = (label, va, vb, win) =>
    `<tr><td>${label}</td><td class="${win === 'a' ? 'win' : ''}">${va}</td><td class="${win === 'b' ? 'win' : ''}">${vb}</td></tr>`;
  const older = a.age_days !== null && b.age_days !== null ? (a.age_days > b.age_days ? 'a' : a.age_days < b.age_days ? 'b' : '') : '';
  const verdict =
    `${a.implied_value_usd === b.implied_value_usd ? 'The model values the two launches equally' : `${(a.implied_value_usd > b.implied_value_usd ? a : b).name} carries the larger implied value, ${money(Math.max(a.implied_value_usd, b.implied_value_usd))} against ${money(Math.min(a.implied_value_usd, b.implied_value_usd))}`}` +
    `, on ${money(Math.max(a.tvl_usd, b.tvl_usd))} against ${money(Math.min(a.tvl_usd, b.tvl_usd))} of TVL. ` +
    (older
      ? `${(older === 'a' ? a : b).name} holds the longer record — ${Math.max(a.age_days, b.age_days)} days tracked with no token, against ${Math.min(a.age_days, b.age_days)}. `
      : '') +
    `Their groups price them differently: ${esc(a.group)} at ${ratioText(a.model.ratio)}, ${esc(b.group)} at ${ratioText(b.model.ratio)}. ` +
    `Farming both costs ${moneyFull((a.plan ? a.plan.capital_usd : 0) + (b.plan ? b.plan.capital_usd : 0))} of capital in total; neither has promised a token, and both values are the model's, with the workings in each protocol's detail view.`;
  $('#cmpout').innerHTML =
    `<div class="tablewrap"><table class="cmp"><thead><tr><th></th><th>${esc(a.name)}</th><th>${esc(b.name)}</th></tr></thead><tbody>` +
    line('Rank', `#${a.rank}`, `#${b.rank}`, a.rank < b.rank ? 'a' : 'b') +
    line('Conviction', TIER_LABEL[tierOf(a)], TIER_LABEL[tierOf(b)], '') +
    line('Group', esc(a.group), esc(b.group), '') +
    line('TVL', money(a.tvl_usd), money(b.tvl_usd), a.tvl_usd > b.tvl_usd ? 'a' : 'b') +
    line('7d change', pct(a.change_7d), pct(b.change_7d), (a.change_7d ?? -Infinity) > (b.change_7d ?? -Infinity) ? 'a' : 'b') +
    line('Age tracked', ageText(a.age_days), ageText(b.age_days), older) +
    line('Group ratio', ratioText(a.model.ratio), ratioText(b.model.ratio), '') +
    line('Growth ×', a.model.growth_factor.toFixed(2), b.model.growth_factor.toFixed(2), '') +
    line('Vintage ×', a.model.vintage_factor.toFixed(2), b.model.vintage_factor.toFixed(2), '') +
    line('Implied value', money(a.implied_value_usd), money(b.implied_value_usd), a.implied_value_usd > b.implied_value_usd ? 'a' : 'b') +
    line('Band', `${money(a.implied_low_usd)} – ${money(a.implied_high_usd)}`, `${money(b.implied_low_usd)} – ${money(b.implied_high_usd)}`, '') +
    line('Farm capital', a.plan ? moneyFull(a.plan.capital_usd) : '—', b.plan ? moneyFull(b.plan.capital_usd) : '—', '') +
    line('Farm hold', a.plan ? `${a.plan.hold_days} days` : '—', b.plan ? `${b.plan.hold_days} days` : '—', '') +
    `</tbody></table></div><p class="lede">${verdict}</p>`;
}

function renderMethod() {
  const byGroup = new Map(R.groups.map((g) => [g.group, { n: 0, tvl: 0, implied: 0, top: null }]));
  for (const r of rows) {
    const s = byGroup.get(r.group);
    s.n += 1;
    s.tvl += r.tvl_usd;
    s.implied += r.implied_value_usd;
    if (!s.top || r.implied_value_usd > s.top.implied_value_usd) s.top = r;
  }
  $('#opptable tbody').innerHTML = [...byGroup.values()]
    .sort((x, y) => y.implied - x.implied)
    .map(
      (s) =>
        `<tr><td>${esc(s.top.group)}</td><td class="num">${s.n}</td><td class="num">${money(s.tvl)}</td>` +
        `<td class="num">${money(s.implied)}</td><td>${esc(s.top.name)} (${money(s.top.implied_value_usd)})</td></tr>`,
    )
    .join('');
  const maxImplied = Math.max(...[...byGroup.values()].map((s) => s.implied));
  $('#groupbars').innerHTML = [...byGroup.values()]
    .sort((x, y) => y.implied - x.implied)
    .map(
      (s) =>
        `<div class="gbar"><span class="gname">${esc(s.top.group)}</span>` +
        `<span class="gtrack"><span class="gfill" style="width:${((100 * s.implied) / maxImplied).toFixed(1)}%"></span></span>` +
        `<span class="gval">${money(s.implied)} across ${s.n}</span></div>`,
    )
    .join('');
  const top = rows[0];
  const stat = R.groups.find((g) => g.group === top.group);
  $('#worked').innerHTML =
    `<strong>Worked example — the board's #1, ${esc(top.name)}.</strong> ` +
    `TVL ${moneyFull(top.tvl_usd)} × group ratio ${ratioText(top.model.ratio)} (the ${esc(top.group)} median across ${stat ? stat.comparables : 0} tokenised comparables) ` +
    `× growth ${top.model.growth_factor.toFixed(2)} (7d TVL ${pct(top.change_7d)}) × vintage ${top.model.vintage_factor.toFixed(2)} (${top.age_days} days tracked, no token) ` +
    `= <strong>${moneyFull(top.implied_value_usd)}</strong>. Its band, at the group's 25th and 75th percentile ratios, is ${moneyFull(top.implied_low_usd)} – ${moneyFull(top.implied_high_usd)}. ` +
    `Every row on the board is this same calculation with its own figures; open any row and its detail view shows the workings in full.`;
  $('#grouptable tbody').innerHTML = R.groups
    .map(
      (g) =>
        `<tr><td>${esc(g.group)}</td><td class="num">${g.comparables}</td>` +
        `<td class="num">${ratioText(g.p25)}</td><td class="num">${ratioText(g.median)}</td><td class="num">${ratioText(g.p75)}</td></tr>`,
    )
    .join('');
}

// ------------------------------------------------------------ wiring

function show(view) {
  state.view = view;
  for (const v of ['board', 'compare', 'live', 'aside', 'method']) {
    $(`#view-${v}`).hidden = v !== view;
  }
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  if (view === 'compare') renderCompare();
  if (view === 'live') renderLive();
  if (view === 'aside') renderAside();
  if (view === 'method') renderMethod();
}

function init() {
  readHash();
  // The full chart lives on the Method tab now: a #chart link lands there, on the panel.
  if (state.chart) state.view = 'method';
  renderMeta();
  renderFormula();
  renderScatter();
  fillSelects();
  renderBoard();
  fillCompare();
  show(['board', 'compare', 'live', 'aside', 'method'].includes(state.view) ? state.view : 'board');
  if (state.slug) openDetail(state.slug);
  if (state.chart) {
    const el = $('#chartpanel');
    if (el) el.scrollIntoView();
  }
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  const rerender = () => {
    state.q = $('#q').value;
    state.cat = $('#cat').value;
    state.chain = $('#chain').value;
    state.band = $('#band').value;
    state.growth = $('#growth').value;
    state.agef = $('#agef').value;
    state.src = $('#src').value;
    state.tier = $('#tier').value;
    renderBoard();
  };
  for (const id of ['#q', '#cat', '#chain', '#band', '#growth', '#agef', '#src', '#tier']) {
    $(id).addEventListener('input', rerender);
    $(id).addEventListener('change', rerender);
  }
  const markPresets = () =>
    document.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.preset === state.preset));
  markPresets();
  document.querySelectorAll('#presets button').forEach((b) =>
    b.addEventListener('click', () => {
      state.preset = b.dataset.preset;
      markPresets();
      renderBoard();
    }),
  );
  for (const id of ['#cmpa', '#cmpb']) {
    $(id).addEventListener('change', () => {
      state.cmpA = $('#cmpa').value;
      state.cmpB = $('#cmpb').value;
      renderCompare();
    });
  }
  document.querySelectorAll('#board th.sortable').forEach((th) =>
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortAsc = !state.sortAsc;
      else {
        state.sortKey = key;
        state.sortAsc = SORT_ASC_DEFAULT[key];
      }
      renderBoard();
    }),
  );
  $('#board tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.dataset.slug);
  });
  $('#scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetail();
  });
}

init();
