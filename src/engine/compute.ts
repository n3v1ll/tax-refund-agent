import type { AssetClass, ClosedPosition, IncomeEvent, Ledger, SourceRef, Trade } from '../model';
import { RULES, taxYearParams, type RuleId } from '../rules/rules';
import { LABELS, type LabelCode } from '../rules/labels';
import { FxError, toAud, type FxTable } from './fx';
import { cents, discountEligible, inRange, sum } from './util';

export type ParcelMethod = 'fifo' | 'lowest_tax';

export interface EngineOptions {
  parcelMethod: ParcelMethod;
  /** Last year's 18V, entered by the user. */
  priorYearLosses: number;
  /** Position id -> asset class, set when the user changes a classification. */
  classificationOverrides: Record<string, AssetClass>;
  /** Ledger item ids the user has excluded (e.g. a duplicate). */
  excludedIds: string[];
}

export const DEFAULT_OPTIONS: EngineOptions = {
  parcelMethod: 'fifo',
  priorYearLosses: 0,
  classificationOverrides: {},
  excludedIds: [],
};

export interface Line {
  description: string;
  amount: number;
  ruleIds: RuleId[];
  source?: SourceRef;
}

export interface Figure {
  code: LabelCode;
  value: number | boolean;
  lines: Line[];
  ruleIds: RuleId[];
  /** Issue ids that must be resolved before this figure can be confirmed. */
  blockedBy: string[];
}

export type IssueSeverity = 'blocker' | 'warning' | 'out_of_scope';

export interface Issue {
  id: string;
  severity: IssueSeverity;
  code: string;
  message: string;
  /** The document or answer that would resolve it, in plain words. */
  ask?: string;
  labels: LabelCode[];
  ruleIds: RuleId[];
  source?: SourceRef;
}

export interface ParcelUsed {
  tradeId: string;
  acquired: string;
  units: number;
  costAud: number;
  source: SourceRef;
}

export interface Disposal {
  id: string;
  broker: string;
  symbol: string;
  date: string;
  units: number;
  proceedsAud: number;
  costAud: number;
  gainAud: number;
  discountEligible: boolean;
  parcels: ParcelUsed[];
  /** Units sold with no matching purchase found. Excluded from totals. */
  unmatchedUnits: number;
  ruleIds: RuleId[];
  source: SourceRef;
}

export interface Classification {
  positionId: string;
  symbol: string;
  brokerType: string;
  assetClass: AssetClass;
  overridden: boolean;
  reason: string;
  ruleIds: RuleId[];
}

export interface CfdLine {
  positionId: string;
  symbol: string;
  closeDate: string;
  profitAud: number;
  financingAud: number;
  source: SourceRef;
}

export interface ReturnResult {
  taxYear: number;
  options: EngineOptions;
  figures: Figure[];
  disposals: Disposal[];
  cfds: CfdLine[];
  classifications: Classification[];
  issues: Issue[];
  cgtSummary: {
    nonDiscountGains: number;
    discountGainsGross: number;
    currentYearLosses: number;
    priorYearLosses: number;
    lossesApplied: number;
    discountApplied: number;
  };
}

class IssueLog {
  issues: Issue[] = [];
  private seen = new Set<string>();
  add(i: Omit<Issue, 'id'> & { id?: string }): string {
    const id = i.id ?? `${i.code}:${this.issues.length}`;
    if (this.seen.has(id)) return id;
    this.seen.add(id);
    this.issues.push({ ...i, id });
    return id;
  }
}

/** Decide how a broker-matched position is taxed. */
export function classifyPosition(p: ClosedPosition, overrides: Record<string, AssetClass>): Classification {
  const base = { positionId: p.id, symbol: p.symbol, brokerType: p.brokerType, ruleIds: ['CLASSIFY_ETORO'] as RuleId[] };
  const o = overrides[p.id];
  if (o) return { ...base, assetClass: o, overridden: true, reason: 'Changed by you' };
  const t = p.brokerType.toLowerCase();
  if (t.includes('crypto') || p.assetClass === 'crypto') return { ...base, assetClass: 'crypto', overridden: false, reason: 'Broker labels it crypto' };
  if (t.includes('cfd') || p.assetClass === 'cfd') return { ...base, assetClass: 'cfd', overridden: false, reason: 'Broker labels it CFD' };
  if (p.leverage > 1) return { ...base, assetClass: 'cfd', overridden: false, reason: `Leveraged x${p.leverage}` };
  if (p.isShort) return { ...base, assetClass: 'cfd', overridden: false, reason: 'Short position' };
  if (p.assetClass === 'etf' || t.includes('etf')) return { ...base, assetClass: 'etf', overridden: false, reason: 'Unleveraged long ETF' };
  if (p.assetClass === 'share' || t.includes('stock') || t.includes('share')) return { ...base, assetClass: 'share', overridden: false, reason: 'Unleveraged long stock' };
  return { ...base, assetClass: 'unknown', overridden: false, reason: `Unrecognised type "${p.brokerType}"` };
}

interface Lot {
  tradeId: string;
  date: string;
  units: number;
  unitCostAud: number;
  source: SourceRef;
}

export function computeReturn(ledgerIn: Ledger, taxYear: number, fx: FxTable, opts: Partial<EngineOptions> = {}): ReturnResult {
  const options: EngineOptions = { ...DEFAULT_OPTIONS, ...opts };
  const year = taxYearParams(taxYear);
  const log = new IssueLog();
  const excluded = new Set(options.excludedIds);
  const ledger = dedupe(ledgerIn, log);

  const lines: Record<LabelCode, Line[]> = Object.fromEntries(LABELS.map((l) => [l.code, []])) as unknown as Record<LabelCode, Line[]>;
  const blockers: Partial<Record<LabelCode, string[]>> = {};
  const block = (labels: LabelCode[], id: string) => labels.forEach((l) => (blockers[l] ??= []).push(id));

  const conv = (amount: number, ccy: string, date: string, labels: LabelCode[], what: string, source?: SourceRef): number | null => {
    try {
      return toAud(fx, amount, ccy, date).aud;
    } catch (e) {
      if (!(e instanceof FxError)) throw e;
      const id = log.add({
        id: `FX_MISSING:${ccy}:${date}`,
        severity: 'blocker',
        code: 'FX_MISSING',
        message: `No RBA ${ccy} exchange rate for ${date} (${what}).`,
        ask: `Load the RBA exchange rate file (F11.1) covering ${date}.`,
        labels,
        ruleIds: ['FX_RBA_DAILY'],
        source,
      });
      block(labels, id);
      return null;
    }
  };

  let outsideYear = 0;

  // ---- Raw trades: parcel matching -------------------------------------
  const disposals: Disposal[] = [];
  const trades = ledger.trades.filter((t) => !excluded.has(t.id) && t.date <= year.end);
  for (const t of trades) {
    if (t.assetClass === 'crypto') {
      log.add({ id: `CRYPTO_TRADE:${t.broker}`, severity: 'out_of_scope', code: 'CRYPTO', message: `Crypto trades from ${t.broker} are not included.`, labels: ['18A'], ruleIds: ['OUT_OF_SCOPE'], source: t.source });
    }
  }
  const groups = new Map<string, Trade[]>();
  for (const t of trades.filter((t) => t.assetClass !== 'crypto' && t.assetClass !== 'cfd')) {
    const k = `${t.broker}|${t.symbol.toUpperCase()}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
  }
  for (const [, ts] of groups) {
    ts.sort((a, b) => (a.date === b.date ? (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1) : a.date < b.date ? -1 : 1));
    const lots: Lot[] = [];
    for (const t of ts) {
      if (t.side === 'buy') {
        const aud = conv(t.units * t.price + t.fees, t.currency, t.date, ['18H', '18A', '18V'], `buy ${t.symbol}`, t.source);
        if (aud === null) continue;
        lots.push({ tradeId: t.id, date: t.date, units: t.units, unitCostAud: aud / t.units, source: t.source });
        continue;
      }
      const inYear = inRange(t.date, year.start, year.end);
      const proceeds = conv(t.units * t.price - t.fees, t.currency, t.date, inYear ? ['18H', '18A', '18V'] : [], `sell ${t.symbol}`, t.source);
      const unitProceeds = proceeds === null ? 0 : proceeds / t.units;
      const picked = pickLots(lots, t.units, t.date, unitProceeds, options.parcelMethod);
      if (!inYear) continue;
      const unmatched = cents(t.units - picked.reduce((a, p) => a + p.units, 0));
      if (unmatched > 1e-6) {
        const id = log.add({
          id: `MISSING_COST_BASE:${t.id}`,
          severity: 'blocker',
          code: 'MISSING_COST_BASE',
          message: unmatched >= t.units - 1e-6
            ? `You sold ${t.units} ${t.symbol} on ${t.date} but we have no record of buying them.`
            : `You sold ${t.units} ${t.symbol} on ${t.date} but we only found purchases for ${cents(t.units - unmatched)} of them.`,
          ask: `Upload an earlier ${brokerName(t.broker)} statement or trade history that shows when you bought ${unmatched} ${t.symbol}, or the buy contract note. You can also type in the purchase date and price.`,
          labels: ['18G', '18H', '18A', '18V'],
          ruleIds: ['CGT_COST_BASE'],
          source: t.source,
        });
        block(['18H', '18A', '18V'], id);
      }
      if (proceeds !== null) disposals.push(...splitDisposal(t, picked, unitProceeds, options.parcelMethod));
    }
  }

  // ---- Broker-matched positions (eToro) --------------------------------
  const classifications: Classification[] = [];
  const cfds: CfdLine[] = [];
  for (const p of ledger.closedPositions) {
    if (excluded.has(p.id)) continue;
    if (!inRange(p.closeDate, year.start, year.end)) { outsideYear++; continue; }
    const c = classifyPosition(p, options.classificationOverrides);
    classifications.push(c);
    if (c.assetClass === 'crypto') {
      log.add({ id: `CRYPTO:${p.broker}`, severity: 'out_of_scope', code: 'CRYPTO', message: `${brokerName(p.broker)} crypto positions are not included. Crypto needs a crypto tax tool or a tax agent.`, labels: ['18A'], ruleIds: ['OUT_OF_SCOPE'], source: p.source });
      continue;
    }
    if (c.assetClass === 'unknown') {
      const id = log.add({ id: `UNCLASSIFIED:${p.id}`, severity: 'blocker', code: 'UNCLASSIFIED', message: `Position ${p.id} (${p.symbol}) has type "${p.brokerType}", which we don't recognise.`, ask: 'Tell us whether it is a real share, an ETF or a CFD.', labels: ['18H', '18A', '24Y'], ruleIds: ['CLASSIFY_ETORO'], source: p.source });
      block(['18H', '18A', '24Y'], id);
      continue;
    }
    if (c.assetClass === 'cfd') {
      const profit = conv(p.profit, p.currency, p.closeDate, ['24Y'], `CFD ${p.symbol}`, p.source);
      const fin = conv(p.financing, p.currency, p.closeDate, ['24Y'], `CFD ${p.symbol} financing`, p.source);
      if (profit === null || fin === null) continue;
      cfds.push({ positionId: p.id, symbol: p.symbol, closeDate: p.closeDate, profitAud: cents(profit), financingAud: cents(fin), source: p.source });
      continue;
    }
    // Real share or ETF held through a broker-matched position.
    const cost = conv(p.invested, p.currency, p.openDate, ['18H', '18A', '18V'], `buy ${p.symbol}`, p.source);
    const proceeds = conv(p.invested + p.profit, p.currency, p.closeDate, ['18H', '18A', '18V'], `sell ${p.symbol}`, p.source);
    if (cost === null || proceeds === null) continue;
    const gain = cents(proceeds - cost);
    disposals.push({
      id: p.id,
      broker: p.broker,
      symbol: p.symbol,
      date: p.closeDate,
      units: p.units,
      proceedsAud: cents(proceeds),
      costAud: cents(cost),
      gainAud: gain,
      discountEligible: gain > 0 && discountEligible(p.openDate, p.closeDate),
      parcels: [{ tradeId: p.id, acquired: p.openDate, units: p.units, costAud: cents(cost), source: p.source }],
      unmatchedUnits: 0,
      ruleIds: ['CGT_PREMATCHED', 'CGT_EVENT_DATE', 'FX_RBA_DAILY', ...(gain > 0 ? (['CGT_DISCOUNT_12M'] as RuleId[]) : [])],
      source: p.source,
    });
  }

  // ---- Capital gains ----------------------------------------------------
  let nonDiscount = 0;
  let discountGross = 0;
  let currentLosses = 0;
  for (const d of disposals) {
    if (d.gainAud >= 0) {
      if (d.discountEligible) discountGross += d.gainAud; else nonDiscount += d.gainAud;
    } else currentLosses += -d.gainAud;
    lines['18H'].push(...(d.gainAud > 0 ? [disposalLine(d)] : []));
  }
  for (const rg of ledger.reportedCapitalGains) {
    nonDiscount += rg.otherGains;
    discountGross += rg.discountGainsGross;
    currentLosses += rg.capitalLosses;
    if (rg.otherGains + rg.discountGainsGross > 0) {
      lines['18H'].push({ description: `${rg.description}: discount gains (before discount) A$${fmt(rg.discountGainsGross)}, other gains A$${fmt(rg.otherGains)}`, amount: cents(rg.otherGains + rg.discountGainsGross), ruleIds: ['PASS_THROUGH'], source: rg.source });
    }
    if (rg.derived) {
      log.add({ id: `DERIVED_CGT:${rg.source.file}`, severity: 'warning', code: 'DERIVED_CGT', message: `${rg.description} only gave totals (18H and 18A), so we worked out its discounted and non-discounted gains from them. This assumes the statement did not subtract any capital losses.`, ask: 'Check the statement shows no capital losses. If it does, upload its realised capital gains report.', labels: ['18A'], ruleIds: ['PASS_THROUGH'], source: rg.source });
    }
  }
  nonDiscount = cents(nonDiscount);
  discountGross = cents(discountGross);
  currentLosses = cents(currentLosses);
  const prior = cents(Math.max(0, options.priorYearLosses));
  let pool = cents(currentLosses + prior);
  const applyNon = Math.min(pool, nonDiscount);
  pool = cents(pool - applyNon);
  const applyDisc = Math.min(pool, discountGross);
  pool = cents(pool - applyDisc);
  const discountAmount = cents((discountGross - applyDisc) * year.cgtDiscountRate);
  const netGain = cents(nonDiscount - applyNon + (discountGross - applyDisc) - discountAmount);
  const total18H = cents(nonDiscount + discountGross);
  const hadEvent = disposals.length > 0 || ledger.reportedCapitalGains.some((r) => r.otherGains + r.discountGainsGross + r.capitalLosses !== 0);

  lines['18A'].push(
    { description: 'Total capital gains (18H)', amount: total18H, ruleIds: ['CGT_COST_BASE'] },
    { description: `Less capital losses from this year (A$${fmt(currentLosses)}) and earlier years (A$${fmt(prior)}) applied`, amount: -cents(applyNon + applyDisc), ruleIds: ['CGT_LOSS_ORDER'] },
    { description: `Less 50% discount on A$${fmt(discountGross - applyDisc)} of gains held 12 months or more`, amount: -discountAmount, ruleIds: ['CGT_DISCOUNT_12M'] },
  );
  for (const d of disposals.filter((d) => d.gainAud < 0)) lines['18V'].push(disposalLine(d));
  if (prior > 0) lines['18V'].push({ description: 'Unused capital losses from earlier years (your 18V last year)', amount: -prior, ruleIds: ['CGT_LOSS_CARRY_FORWARD'] });
  lines['18V'].push({ description: 'Losses used against this year\'s gains', amount: cents(applyNon + applyDisc), ruleIds: ['CGT_LOSS_ORDER'] });
  lines['18G'].push({ description: hadEvent ? `${disposals.length} sale(s) or reported capital gains this year` : 'No sales or reported capital gains found', amount: 0, ruleIds: ['CGT_EVENT_DATE'] });

  // ---- CFDs ---------------------------------------------------------------
  const cfdNet = sum(cfds.map((c) => c.profitAud + c.financingAud));
  for (const c of cfds) {
    lines['24Y'].push({ description: `CFD ${c.symbol} closed ${c.closeDate}: profit A$${fmt(c.profitAud)}, financing A$${fmt(c.financingAud)}`, amount: cents(c.profitAud + c.financingAud), ruleIds: ['CFD_REVENUE', 'FX_RBA_DAILY'], source: c.source });
  }
  if (cfdNet < 0) {
    log.add({ id: 'CFD_NET_LOSS', severity: 'out_of_scope', code: 'CFD_NET_LOSS', message: `Your CFDs made a net loss of A$${fmt(-cfdNet)}. Whether you can deduct it depends on your circumstances, so it is not included.`, ask: 'Ask a registered tax agent whether this loss is deductible for you.', labels: ['24Y'], ruleIds: ['OUT_OF_SCOPE', 'CFD_REVENUE'] });
  }

  // ---- Income -------------------------------------------------------------
  let foreignTax = 0;
  for (const e of ledger.income) {
    if (excluded.has(e.id)) continue;
    if (!inRange(e.date, year.start, year.end)) { outsideYear++; continue; }
    foreignTax += incomeLines(e, lines, conv, log, block);
  }
  foreignTax = cents(foreignTax);

  for (const f of ledger.reported) {
    if (excluded.has(f.source.file + f.label)) continue;
    const code = f.label as LabelCode;
    if (code.startsWith('18')) continue; // handled through reportedCapitalGains
    if (!lines[code]) {
      log.add({ id: `UNMAPPED:${f.label}:${f.source.file}`, severity: 'warning', code: 'UNMAPPED_LABEL', message: `${f.description} is reported at label ${f.label}, which this tool does not fill. Enter it in myTax yourself.`, labels: [], ruleIds: ['PASS_THROUGH'], source: f.source });
      continue;
    }
    lines[code].push({ description: f.description, amount: f.amount, ruleIds: ['PASS_THROUGH'], source: f.source });
    if (code === '20O') foreignTax = cents(foreignTax + f.amount);
  }

  if (foreignTax > year.fitoNoCalcThreshold) {
    log.add({ id: 'FITO_LIMIT', severity: 'warning', code: 'FITO_LIMIT', message: `Foreign tax paid totals A$${fmt(foreignTax)}, over the A$${year.fitoNoCalcThreshold} limit. 20O shows A$${year.fitoNoCalcThreshold}, which you can claim without a calculation. Claiming more needs the offset limit worked out.`, ask: 'If you want to claim more than A$1,000, ask a registered tax agent to work out your offset limit.', labels: ['20O'], ruleIds: ['FITO'] });
  }
  if (outsideYear > 0) {
    log.add({ id: 'OUTSIDE_YEAR', severity: 'warning', code: 'OUTSIDE_YEAR', message: `${outsideYear} item(s) dated outside ${year.start} to ${year.end} were left out.`, labels: [], ruleIds: ['TAX_YEAR'] });
  }
  for (const w of ledger.warnings) log.add({ severity: 'warning', code: 'PARSE', message: `${w.file}: ${w.message}`, labels: [], ruleIds: [] });

  // ---- Figures ------------------------------------------------------------
  const lineSum = (c: LabelCode) => sum(lines[c].map((l) => l.amount));
  const value: Record<LabelCode, number | boolean> = {
    '10L': lineSum('10L'),
    '11S': lineSum('11S'),
    '11T': lineSum('11T'),
    '11U': lineSum('11U'),
    '13U': lineSum('13U'),
    '13C': lineSum('13C'),
    '13Q': lineSum('13Q'),
    '18G': hadEvent,
    '18H': total18H,
    '18A': netGain,
    '18V': pool,
    '20E': lineSum('20E'),
    '20M': lineSum('20M'),
    '20O': Math.min(foreignTax, year.fitoNoCalcThreshold),
    '24Y': Math.max(0, cfdNet),
  };
  const figureRules: Record<LabelCode, RuleId[]> = {
    '10L': ['INTEREST'], '11S': ['DIV_AU'], '11T': ['DIV_AU'], '11U': ['DIV_AU'],
    '13U': ['PASS_THROUGH'], '13C': ['PASS_THROUGH'], '13Q': ['PASS_THROUGH'],
    '18G': ['CGT_EVENT_DATE'], '18H': ['CGT_COST_BASE', 'CGT_EVENT_DATE', 'FX_RBA_DAILY'],
    '18A': ['CGT_LOSS_ORDER', 'CGT_DISCOUNT_12M'], '18V': ['CGT_LOSS_CARRY_FORWARD'],
    '20E': ['FOREIGN_INCOME_GROSS', 'FX_RBA_DAILY'], '20M': ['FOREIGN_INCOME_GROSS'], '20O': ['FITO'],
    '24Y': ['CFD_REVENUE'],
  };
  if (options.parcelMethod === 'fifo') figureRules['18H'].push('CGT_PARCEL_FIFO'); else figureRules['18H'].push('CGT_PARCEL_SPECIFIC');

  const figures: Figure[] = LABELS.map((l) => ({
    code: l.code,
    value: value[l.code],
    lines: lines[l.code],
    ruleIds: figureRules[l.code],
    blockedBy: [...new Set(blockers[l.code] ?? [])],
  }));

  return {
    taxYear,
    options,
    figures,
    disposals,
    cfds,
    classifications,
    issues: log.issues,
    cgtSummary: {
      nonDiscountGains: nonDiscount,
      discountGainsGross: discountGross,
      currentYearLosses: currentLosses,
      priorYearLosses: prior,
      lossesApplied: cents(applyNon + applyDisc),
      discountApplied: discountAmount,
    },
  };
}

type Conv = (amount: number, ccy: string, date: string, labels: LabelCode[], what: string, source?: SourceRef) => number | null;

/** Adds lines for one income event; returns foreign tax in AUD. */
function incomeLines(e: IncomeEvent, lines: Record<LabelCode, Line[]>, conv: Conv, log: IssueLog, block: (l: LabelCode[], id: string) => void): number {
  const what = `${e.kind} ${e.symbol ?? e.name ?? ''} ${e.date}`.trim();
  const label = e.symbol ?? e.name ?? 'payment';
  if (e.country === 'AU') {
    if (e.kind === 'interest') {
      const g = conv(e.netAmount + e.withholding, e.currency, e.date, ['10L'], what, e.source);
      if (g !== null) lines['10L'].push({ description: `Interest ${label} ${e.date}`, amount: cents(g), ruleIds: ['INTEREST'], source: e.source });
      return 0;
    }
    if (e.frankedAmount === undefined && e.unfrankedAmount === undefined) {
      const id = log.add({ id: `FRANKING_MISSING:${e.id}`, severity: 'blocker', code: 'FRANKING_MISSING', message: `The ${label} dividend paid ${e.date} has no franking details.`, ask: `Upload the ${label} dividend statement (from the share registry, e.g. Computershare or Link) that shows the franked amount and franking credit.`, labels: ['11S', '11T', '11U'], ruleIds: ['DIV_AU'], source: e.source });
      block(['11S', '11T', '11U'], id);
      return 0;
    }
    const f = conv(e.frankedAmount ?? 0, e.currency, e.date, ['11T'], what, e.source);
    const u = conv(e.unfrankedAmount ?? 0, e.currency, e.date, ['11S'], what, e.source);
    const fc = conv(e.frankingCredit ?? 0, e.currency, e.date, ['11U'], what, e.source);
    if (u) lines['11S'].push({ description: `${label} dividend ${e.date}, unfranked`, amount: cents(u), ruleIds: ['DIV_AU'], source: e.source });
    if (f) lines['11T'].push({ description: `${label} dividend ${e.date}, franked`, amount: cents(f), ruleIds: ['DIV_AU'], source: e.source });
    if (fc) lines['11U'].push({ description: `${label} dividend ${e.date}, franking credit`, amount: cents(fc), ruleIds: ['DIV_AU'], source: e.source });
    return 0;
  }
  const gross = conv(e.netAmount + e.withholding, e.currency, e.date, ['20E', '20M'], what, e.source);
  const tax = conv(e.withholding, e.currency, e.date, ['20O'], what, e.source);
  if (gross === null) return 0;
  const desc = `${label} ${e.kind} ${e.date}: received ${e.currency} ${fmt(e.netAmount)} + withheld ${e.currency} ${fmt(e.withholding)}`;
  lines['20E'].push({ description: desc, amount: cents(gross), ruleIds: ['FOREIGN_INCOME_GROSS', 'FX_RBA_DAILY'], source: e.source });
  lines['20M'].push({ description: desc, amount: cents(gross), ruleIds: ['FOREIGN_INCOME_GROSS', 'FX_RBA_DAILY'], source: e.source });
  if (tax) lines['20O'].push({ description: `${label} ${e.date}: foreign tax withheld`, amount: cents(tax), ruleIds: ['FITO', 'FX_RBA_DAILY'], source: e.source });
  return tax ?? 0;
}

function pickLots(lots: Lot[], units: number, sellDate: string, unitProceeds: number, method: ParcelMethod): ParcelUsed[] {
  const avail = lots.filter((l) => l.units > 1e-9);
  if (method === 'lowest_tax') {
    const score = (l: Lot) => {
      const g = unitProceeds - l.unitCostAud;
      if (g < 0) return g; // losses first, biggest loss first
      return discountEligible(l.date, sellDate) ? g * 0.5 : g;
    };
    avail.sort((a, b) => score(a) - score(b) || (a.date < b.date ? -1 : 1));
  } else {
    avail.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  const out: ParcelUsed[] = [];
  let need = units;
  for (const l of avail) {
    if (need <= 1e-9) break;
    const take = Math.min(need, l.units);
    l.units -= take;
    need -= take;
    out.push({ tradeId: l.tradeId, acquired: l.date, units: take, costAud: l.unitCostAud * take, source: l.source });
  }
  return out;
}

/**
 * One sale can use parcels on both sides of the 12-month line, so split it
 * into one disposal per parcel.
 */
function splitDisposal(t: Trade, parcels: ParcelUsed[], unitProceeds: number, method: ParcelMethod): Disposal[] {
  const methodRule: RuleId = method === 'fifo' ? 'CGT_PARCEL_FIFO' : 'CGT_PARCEL_SPECIFIC';
  const unmatched = t.units - parcels.reduce((a, p) => a + p.units, 0);
  const out = parcels.map((p, i): Disposal => {
    const proceeds = cents(unitProceeds * p.units);
    const cost = cents(p.costAud);
    const gain = cents(proceeds - cost);
    return {
      id: parcels.length > 1 ? `${t.id}#${i + 1}` : t.id,
      broker: t.broker,
      symbol: t.symbol,
      date: t.date,
      units: p.units,
      proceedsAud: proceeds,
      costAud: cost,
      gainAud: gain,
      discountEligible: gain > 0 && discountEligible(p.acquired, t.date),
      parcels: [{ ...p, costAud: cost }],
      unmatchedUnits: i === 0 ? Math.max(0, cents(unmatched)) : 0,
      ruleIds: [methodRule, 'CGT_COST_BASE', 'CGT_EVENT_DATE', 'FX_RBA_DAILY', ...(gain > 0 ? (['CGT_DISCOUNT_12M'] as RuleId[]) : [])],
      source: t.source,
    };
  });
  if (out.length === 0 && unmatched > 0) {
    out.push({ id: t.id, broker: t.broker, symbol: t.symbol, date: t.date, units: 0, proceedsAud: 0, costAud: 0, gainAud: 0, discountEligible: false, parcels: [], unmatchedUnits: cents(unmatched), ruleIds: [methodRule], source: t.source });
  }
  return out.filter((d) => d.units > 0 || d.unmatchedUnits > 0);
}

function disposalLine(d: Disposal): Line {
  const acq = d.parcels.map((p) => p.acquired).join(', ');
  const tag = d.gainAud < 0 ? 'capital loss' : d.discountEligible ? 'held 12+ months, discount applies' : 'held under 12 months';
  return {
    description: `Sold ${round4(d.units)} ${d.symbol} on ${d.date} (bought ${acq}): proceeds A$${fmt(d.proceedsAud)} less cost A$${fmt(d.costAud)}, ${tag}`,
    amount: d.gainAud,
    ruleIds: d.ruleIds,
    source: d.source,
  };
}

function dedupe(l: Ledger, log: IssueLog): Ledger {
  const uniq = <T extends { id: string }>(xs: T[], what: string): T[] => {
    const seen = new Set<string>();
    const out: T[] = [];
    let dup = 0;
    for (const x of xs) {
      if (seen.has(x.id)) { dup++; continue; }
      seen.add(x.id);
      out.push(x);
    }
    if (dup) log.add({ id: `DUP:${what}`, severity: 'warning', code: 'DUPLICATE', message: `${dup} duplicate ${what} were ignored (the same statement may have been uploaded twice).`, labels: [], ruleIds: [] });
    return out;
  };
  return { ...l, trades: uniq(l.trades, 'trades'), closedPositions: uniq(l.closedPositions, 'positions'), income: uniq(l.income, 'income payments') };
}

export function brokerName(b: string): string {
  return ({ etoro: 'eToro', 'cmc-invest': 'CMC Invest', stockspot: 'Stockspot', generic: 'broker', manual: 'manual' } as Record<string, string>)[b] ?? b;
}

function fmt(n: number): string {
  return n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export { RULES };
