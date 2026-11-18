// The token launch radar's model: one sealed snapshot of the protocol universe in, one ranked
// board out. Everything the board claims is computed here from the snapshot's own figures; no
// protocol name is special-cased anywhere in this file.
//
// Eligibility (the radar's filter). A protocol is ranked when it records no token (both its
// CoinGecko id and its symbol are null in DefiLlama's record) and it is not a wrapped, staked or
// bridged product of a protocol whose token already trades. The field guide (input/README.md)
// operationalises "not a product" with a parent-protocol field the snapshot does not carry, so
// this model applies every part of the rule the snapshot's ten fields can check: the category is
// not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX; the name
// ends in no version marker; the name carries no whole word wrapped, staked or staking; and the
// name does not begin with an exchange's name. The snapshot's watchlist is covered in full
// regardless: it is the floor, never the ceiling, and its coverage is the gate's row.
//
// Implied value (what a launch would be worth if the protocol's record stayed as it is):
//
//   ratio    the market-cap-to-TVL ratio of the protocol's category group, taken from the
//            snapshot's own tokenised protocols: each group's median ratio (each ratio clipped
//            to [0.01, 3] first), shrunk toward the market-wide median by the group's sample
//            size, ratio = (n x group median + 8 x global median) / (n + 8); then capped at
//            the richest ratio the snapshot records at the protocol's size (at TVL of $250M or
//            more no tokenised protocol in the snapshot trades above 0.45 x TVL; at $50M or
//            more, none above 1.05 x).
//   growth   1 + clamp(change_7d, -25, +25) / 100 x 1.5, an unreported change counting as 0.
//   vintage  0.8 + 0.4 x min(age_days, 1460) / 1460, where age_days counts from the day
//            DefiLlama began tracking the protocol to the snapshot's date; an unknown age
//            takes the neutral 0.95.
//   implied  = round(TVL x ratio x growth x vintage), at least $1.
//
// The band beside each value runs the same formula at the group's shrunk 25th and 75th
// percentile ratios: it is the spread of what comparable launches actually captured, not a
// confidence interval invented for the page.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard so a reader can re-derive every number. */
export interface ModelConstants {
  shrinkage_k: number;
  ratio_clip_low: number;
  ratio_clip_high: number;
  size_cap_big_tvl: number;
  size_cap_big: number;
  size_cap_mid_tvl: number;
  size_cap_mid: number;
  growth_clamp_pct: number;
  growth_weight: number;
  vintage_floor: number;
  vintage_range: number;
  vintage_days: number;
  unknown_age_factor: number;
}

export const MODEL: ModelConstants = {
  shrinkage_k: 8,
  ratio_clip_low: 0.01,
  ratio_clip_high: 3,
  size_cap_big_tvl: 250_000_000,
  size_cap_big: 0.45,
  size_cap_mid_tvl: 50_000_000,
  size_cap_mid: 1.05,
  growth_clamp_pct: 25,
  growth_weight: 1.5,
  vintage_floor: 0.8,
  vintage_range: 0.4,
  vintage_days: 1460,
  unknown_age_factor: 0.95,
};

/** The model's version label: the dashboard names it and the board carries it. */
export const MODEL_VERSION = 'radar-2';

/** The category groups the comparable ratios are read over, in the order the page lists them. */
export const GROUPS = [
  'Trading venues',
  'Lending & credit',
  'Curators & allocators',
  'Yield & staking',
  'RWA & payments',
  'Chains & infra',
  'Other',
] as const;

export type Group = (typeof GROUPS)[number];

/** DefiLlama's categories mapped to the group whose tokenised protocols price a launch like it. */
const CATEGORY_GROUP: Record<string, Group> = {
  'Dexs': 'Trading venues',
  'Derivatives': 'Trading venues',
  'Prediction Market': 'Trading venues',
  'OTC Marketplace': 'Trading venues',
  'Liquidity Manager': 'Trading venues',
  'Lending': 'Lending & credit',
  'CDP': 'Lending & credit',
  'CDP Manager': 'Lending & credit',
  'Collateral Markets': 'Lending & credit',
  'Risk Curators': 'Curators & allocators',
  'Onchain Capital Allocator': 'Curators & allocators',
  'Yield Aggregator': 'Curators & allocators',
  'Yield': 'Yield & staking',
  'Staking Pool': 'Yield & staking',
  'Restaking': 'Yield & staking',
  'Basis Trading': 'Yield & staking',
  'Leveraged Farming': 'Yield & staking',
  'Farm': 'Yield & staking',
  'RWA': 'RWA & payments',
  'Payments': 'RWA & payments',
  'Chain': 'Chains & infra',
  'Cross Chain Bridge': 'Chains & infra',
};

/** The group a category is priced with; an unmapped or absent category reads as Other. */
export function groupOf(category: string | null): Group {
  if (category === null) return 'Other';
  return CATEGORY_GROUP[category] ?? 'Other';
}

// ---------------------------------------------------------------- eligibility

/** Categories the field guide names as products of another protocol, never launches of their own. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchanges the field guide names: a protocol whose name begins with one is the exchange's own entry. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name marks a product of an asset that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether the protocol's record names a token: both ids null means it records none. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Why a protocol is set aside as a product of one that trades, or null when it is a launch candidate. */
export function productExclusion(p: SnapshotProtocol): string | null {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return `category ${p.category}: a product of another protocol`;
  if (VERSIONED.test(p.name)) return 'name ends in a version marker: a pool of another protocol';
  if (PRODUCT_WORD.test(p.name)) return 'name carries a product word (wrapped, staked or staking)';
  for (const prefix of EXCHANGE_PREFIXES) if (p.name.startsWith(prefix)) return `name begins with ${prefix}: an exchange's own entry`;
  return null;
}

/** Whether the board may rank a protocol: it records no token and is no product of one that trades. */
export function isEligible(p: SnapshotProtocol): boolean {
  return recordsNoToken(p) && productExclusion(p) === null;
}

// ---------------------------------------------------------------- figures

const DAY_MS = 86_400_000;

/** A whole day count from the day DefiLlama began tracking a protocol to the snapshot's date; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** One quantile of a sorted array, exclusive method: the position q x (n + 1), interpolated. */
function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const pos = q * (n + 1);
  if (pos <= 1) return sorted[0]!;
  if (pos >= n) return sorted[n - 1]!;
  const lo = Math.floor(pos);
  return sorted[lo - 1]! + (pos - lo) * (sorted[lo]! - sorted[lo - 1]!);
}

/** One group's comparable evidence: how many tokenised protocols, and the ratios they trade at. */
export interface GroupStat {
  group: Group;
  comparables: number;
  median: number;
  p25: number;
  p75: number;
}

/** Every group's stats: medians and quartiles of clipped market-cap-to-TVL ratios, shrunk to the market's. */
export function groupStats(protocols: SnapshotProtocol[], model: ModelConstants = MODEL): Map<Group, GroupStat> {
  const ratios = new Map<Group, number[]>();
  const all: number[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const r = clamp(p.mcap_usd / p.tvl_usd, model.ratio_clip_low, model.ratio_clip_high);
    const g = groupOf(p.category);
    const list = ratios.get(g);
    if (list === undefined) ratios.set(g, [r]);
    else list.push(r);
    all.push(r);
  }
  all.sort((a, b) => a - b);
  const global = { median: quantile(all, 0.5), p25: quantile(all, 0.25), p75: quantile(all, 0.75) };
  const stats = new Map<Group, GroupStat>();
  for (const group of GROUPS) {
    const list = (ratios.get(group) ?? []).slice().sort((a, b) => a - b);
    const n = list.length;
    const shrink = (f: (xs: number[]) => number, g: number): number =>
      n === 0 ? g : (n * f(list) + model.shrinkage_k * g) / (n + model.shrinkage_k);
    stats.set(group, {
      group,
      comparables: n,
      median: shrink((xs) => quantile(xs, 0.5), global.median),
      p25: shrink((xs) => quantile(xs, 0.25), global.p25),
      p75: shrink((xs) => quantile(xs, 0.75), global.p75),
    });
  }
  return stats;
}

/** The richest ratio the model allows at a protocol's size, read off the snapshot's large-cap record. */
export function sizeCap(tvl: number, model: ModelConstants = MODEL): number {
  if (tvl >= model.size_cap_big_tvl) return model.size_cap_big;
  if (tvl >= model.size_cap_mid_tvl) return model.size_cap_mid;
  return model.ratio_clip_high;
}

/** A protocol scored: its implied value, its band, and every factor that produced them. */
export interface Scored {
  group: Group;
  ratio: number;
  ratio_low: number;
  ratio_high: number;
  growth_factor: number;
  vintage_factor: number;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
}

/** Score one protocol under the model; the same function scores every row of the board. */
export function score(p: SnapshotProtocol, asOf: string, stats: Map<Group, GroupStat>, model: ModelConstants = MODEL): Scored {
  const group = groupOf(p.category);
  const stat = stats.get(group)!;
  const cap = sizeCap(p.tvl_usd, model);
  const ratio = Math.min(stat.median, cap);
  const ratioLow = Math.min(stat.p25, cap);
  const ratioHigh = Math.min(stat.p75, cap);
  const growthPct = clamp(p.change_7d ?? 0, -model.growth_clamp_pct, model.growth_clamp_pct);
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const vintageFactor =
    age === null ? model.unknown_age_factor : model.vintage_floor + (Math.min(age, model.vintage_days) / model.vintage_days) * model.vintage_range;
  const at = (r: number): number => Math.max(1, Math.round(p.tvl_usd * r * growthFactor * vintageFactor));
  return {
    group,
    ratio: round4(ratio),
    ratio_low: round4(ratioLow),
    ratio_high: round4(ratioHigh),
    growth_factor: round4(growthFactor),
    vintage_factor: round4(vintageFactor),
    age_days: age,
    implied_value_usd: at(ratio),
    implied_low_usd: at(ratioLow),
    implied_high_usd: at(ratioHigh),
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- farm plans

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction roughly costs on a protocol's first chain, in plain words. */
function feeWords(chain: string): string {
  if (chain === 'Ethereum') return 'about $5 of gas on Ethereum';
  if (chain === 'Solana') return 'a few cents of Solana fees';
  if (chain === 'Bitcoin') return 'about $1 of Bitcoin fees';
  if (chain === 'Tron') return 'about $1 of Tron energy fees';
  return 'about $1 of network fees';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 250_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

/** How long to hold, from the protocol's age: a younger record earns a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The two qualifying actions of a category's farm plan: what a farmer actually does there. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): [string, string] {
  const c = p.category ?? '';
  const name = p.name;
  switch (c) {
    case 'Dexs':
      return [
        `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} — a stablecoin pair if it offers one — and keep the LP position open.`,
        `Route one swap of about $50 through ${name} itself each week instead of an aggregator, so the wallet reads as a trader as well as a liquidity provider.`,
      ];
    case 'Derivatives':
      return [
        `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small position hedged with a spot position of the same size, so the account trades without carrying naked risk.`,
        `Roll or re-open the hedge once a week, so the account shows recurring trading rather than one parked deposit.`,
      ];
    case 'Prediction Market':
      return [
        `Fund ${name} with $${capital} on ${chain} and take positions in three of its most liquid markets, each sized under $25.`,
        `Settle or roll each position as its market resolves, and keep a working balance on the platform between markets.`,
      ];
    case 'Lending':
      return [
        `Supply $${capital} of USDC to ${name} on ${chain}; if it lets you borrow against the supply, borrow no more than a third of it and keep the health factor above 2.`,
        `Repay and re-borrow a small part of the loan once a week, so the account shows both sides of the market.`,
      ];
    case 'CDP':
    case 'CDP Manager':
      return [
        `Deposit $${capital} of collateral into ${name} on ${chain} and mint its stablecoin at under half the debt the collateral allows.`,
        `Repay a slice of the minted debt and re-mint it once a week, so the vault shows continuing use rather than one mint.`,
      ];
    case 'Collateral Markets':
      return [
        `Deposit $${capital} of collateral into ${name} on ${chain} and leave it supplied.`,
        `Move a small part of the collateral between its markets once a week, so more than one market knows the wallet.`,
      ];
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
    case 'Yield Aggregator':
      return [
        `Deposit $${capital} into a ${name} vault on ${chain} — pick the vault whose strategy you can describe in one sentence — and keep the shares in the wallet.`,
        `Place a second, smaller deposit of about $25 into a different ${name} vault, so the wallet holds more than one of its strategies.`,
      ];
    case 'Restaking':
      return [
        `Restake $${capital} of a liquid staking token through ${name} on ${chain} and keep the restaking receipt in the wallet.`,
        `Claim and restake the rewards once a month, and read its slashing terms before adding a dollar more.`,
      ];
    case 'Staking Pool':
      return [
        `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the staking receipt in the wallet.`,
        `Restake the rewards once a month, so the position grows from the same wallet.`,
      ];
    case 'Basis Trading':
      return [
        `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the shares.`,
        `Add a small top-up once a month instead of withdrawing in a week when the funding rate dips.`,
      ];
    case 'Leveraged Farming':
      return [
        `Open one small leveraged farm on ${name} on ${chain} with $${capital}, at the lowest leverage it offers, and set its unwind alerts on day one.`,
        `Rebalance the position once a week so it never drifts near its liquidation point.`,
      ];
    case 'RWA':
      return [
        `Buy or mint $${capital} of ${name}'s yield asset on ${chain} and hold it; if minting is allowlisted, buy the same asset in its secondary pool instead and note that you did.`,
        `Hold through at least one full distribution or interest period, so the wallet is on record as a holder, not a flipper.`,
      ];
    case 'Payments':
      return [
        `Open a ${name} account or channel on ${chain} with $${capital} and route one real payment of about $25 through it.`,
        `Route one payment a week, even a small one, so the account builds a payment history rather than a parked balance.`,
      ];
    case 'Chain':
      return [
        `Bridge $${capital} to the ${name} network and make this wallet active there for a month: swaps first, then one lending position, then one app unique to the chain.`,
        `Keep a small balance of its gas asset and transact at least twice a week, so the wallet ages as a native user of the chain.`,
      ];
    case 'Cross Chain Bridge':
      return [
        `Bridge $${capital} through ${name} to ${chain} and use the funds in one app on the far side, rather than bridging straight back.`,
        `Bridge a smaller amount on a second route, or back in a later week, so both directions are on record.`,
      ];
    default:
      return [
        `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
        `Make one further qualifying action each week — a top-up, a vote, or a withdrawal and re-deposit — so the wallet shows continuing use.`,
      ];
  }
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record — its category's product, its first chain's fees, its TVL's capital
 * tier and its age's hold window. Never a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const fee = feeWords(chain);
  const [first, second] = actionsFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm ${p.name} with, and keep its seed phrase offline.`,
      cost: 'nothing to set up',
      time: '5 minutes',
    },
    { text: first, cost: `$${capital} of capital and ${fee}`, time: '15 minutes to set up' },
    { text: second, cost: `${fee} each time`, time: '10 minutes a week' },
    {
      text: `Repeat one qualifying action every week — the deposit, trade or vote the plan above names — and never let a week pass with no transaction.`,
      cost: `${fee} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity is counted in more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, check ${p.name}'s own points or rewards page and claim only from a link it publishes; then write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
  ];
}

/** The risks a detail view states for a protocol, each derived from its own record. */
export function risksFor(p: SnapshotProtocol, age: number | null): string[] {
  const risks: string[] = [];
  const c = p.category ?? '';
  if (c === 'Derivatives' || c === 'Leveraged Farming') {
    risks.push('Leverage: positions here can be liquidated, which is why the plan hedges or takes the lowest leverage on offer.');
  } else if (c === 'RWA') {
    risks.push('Issuer risk: the asset\u2019s value rests on an off-chain issuer and its attestations, not only on the contract.');
  } else if (c === 'Risk Curators' || c === 'Onchain Capital Allocator' || c === 'Yield Aggregator') {
    risks.push('Curator risk: a curator chooses the vault\u2019s strategy, and a bad strategy can lose money even when every contract works as written.');
  } else if (c === 'CDP' || c === 'CDP Manager') {
    risks.push('Liquidation: the minted debt sits against volatile collateral, which is why the plan mints under half the allowed maximum.');
  } else if (c === 'Restaking') {
    risks.push('Slashing: restaked assets can be slashed for an operator\u2019s faults, a loss a plain staking position does not carry.');
  } else if (c === 'Prediction Market') {
    risks.push('Event risk: positions settle on real-world outcomes and can go to zero at resolution.');
  } else if (c === 'Chain' || c === 'Cross Chain Bridge') {
    risks.push('Bridge risk: reaching this position crosses a bridge, and bridged assets carry the bridge\u2019s own security model.');
  }
  if (p.change_7d !== null && p.change_7d <= -10) {
    risks.push(`Momentum: TVL fell ${Math.abs(p.change_7d).toFixed(1)}% in the seven days before the snapshot; the model already marks it down, and a shrinking protocol can keep shrinking.`);
  }
  if (age !== null && age < 120) {
    risks.push(`Young record: DefiLlama has tracked it for only ${age} days, so its TVL has not yet survived a full market cycle.`);
  }
  if (age === null) {
    risks.push('No listing date in the record: how long it has run cannot be verified from the snapshot, so the model gives it the neutral vintage factor.');
  }
  if (p.chains.length === 1) {
    risks.push(`Single chain: all of its TVL sits on ${p.chains[0]}, so a problem on that chain is a problem for the whole position.`);
  }
  risks.push('No token is promised: the record names none today, the protocol may never issue one, and the implied value is a model estimate, not a price.');
  return risks.slice(0, 4);
}

// ---------------------------------------------------------------- the board

/** One row of board.json: the ranked board's row, with the workings that produced its value. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  group: Group;
  token_status: 'pre-token';
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    ratio: number;
    ratio_low: number;
    ratio_high: number;
    growth_factor: number;
    vintage_factor: number;
  };
  farm_steps: string[];
}

/** A tokenised protocol, set apart from the board: the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  group: Group;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** A protocol the filter set aside, with the reason, for the dashboard's separation view. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** Everything the dashboard renders: the board, the live set, the set-asides and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  set_aside_size: number;
  live_size: number;
  groups: GroupStat[];
  rows: (BoardRow & { risks: string[]; farm_detail: FarmStep[]; plan: { capital_usd: number; hold_days: number } })[];
  live: LiveRow[];
  aside: AsideRow[];
  comparables: Record<string, { name: string; tvl_usd: number; mcap_usd: number; ratio: number }[]>;
}

/** How many live-token protocols the dashboard's Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many set-aside protocols the dashboard names, by TVL. */
export const ASIDE_ROWS = 12;

/** The protocols the board ranks, strongest first, with ranks 1..n and the watchlist covered in full. */
export function buildBoard(snapshot: Snapshot, stats: Map<Group, GroupStat>, model: ModelConstants = MODEL): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => isEligible(p) || watchlist.has(p.slug));
  const scored = chosen.map((p) => ({ p, s: score(p, snapshot.as_of, stats, model) }));
  scored.sort((a, b) => b.s.implied_value_usd - a.s.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: s.age_days,
    watchlist: watchlist.has(p.slug),
    group: s.group,
    token_status: 'pre-token',
    implied_value_usd: s.implied_value_usd,
    implied_low_usd: s.implied_low_usd,
    implied_high_usd: s.implied_high_usd,
    model: {
      ratio: s.ratio,
      ratio_low: s.ratio_low,
      ratio_high: s.ratio_high,
      growth_factor: s.growth_factor,
      vintage_factor: s.vintage_factor,
    },
    farm_steps: farmSteps(p, s.age_days).map(stepText),
  }));
}

/** The tokenised protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p))
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      group: groupOf(p.category),
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The no-token protocols the product rule set aside, largest first, each with its reason. */
export function asideRows(snapshot: Snapshot): AsideRow[] {
  return snapshot.protocols
    .filter((p) => recordsNoToken(p) && !isEligible(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, ASIDE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: productExclusion(p)! }));
}

/** The tokenised evidence behind each group's ratio: its largest protocols and what they trade at. */
export function comparablesByGroup(snapshot: Snapshot): Record<string, { name: string; tvl_usd: number; mcap_usd: number; ratio: number }[]> {
  const out: Record<string, { name: string; tvl_usd: number; mcap_usd: number; ratio: number }[]> = {};
  for (const group of GROUPS) {
    out[group] = snapshot.protocols
      .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0 && groupOf(p.category) === group)
      .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
      .slice(0, 6)
      .map((p) => ({ name: p.name, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, ratio: round4(p.mcap_usd! / p.tvl_usd) }));
  }
  return out;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const stats = groupStats(snapshot.protocols, model);
  const board = buildBoard(snapshot, stats, model);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    set_aside_size: snapshot.protocols.filter((p) => recordsNoToken(p) && !isEligible(p)).length,
    live_size: snapshot.protocols.filter((p) => !recordsNoToken(p)).length,
    groups: GROUPS.map((g) => stats.get(g)!),
    rows: board.map((row) => ({
      ...row,
      risks: risksFor(bySlug.get(row.slug)!, row.age_days),
      farm_detail: farmSteps(bySlug.get(row.slug)!, row.age_days),
      // The plan's rollup, from the same helpers that generate its steps: the capital the
      // position holds and the hold window its age earns. Setup is the wallet, the first
      // action and the closing check (about 30 minutes); the cadence is one weekly round.
      plan: { capital_usd: capitalFor(bySlug.get(row.slug)!), hold_days: holdDaysFor(row.age_days) },
    })),
    live: liveRows(snapshot),
    aside: asideRows(snapshot),
    comparables: comparablesByGroup(snapshot),
  };
  return { board, radar };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, values and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = board.slice().sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outvalues rank ${i}`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
