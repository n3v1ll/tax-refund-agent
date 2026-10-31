/**
 * The normalised ledger. Every parser turns a broker document into these
 * shapes and nothing else. Parsers never make tax decisions: they only record
 * what the document says. All tax treatment happens in src/engine using the
 * published rules in src/rules.
 */

export type Broker = 'etoro' | 'cmc-invest' | 'stockspot' | 'generic' | 'manual';

export type AssetClass = 'share' | 'etf' | 'cfd' | 'crypto' | 'unknown';

/** ISO date, yyyy-mm-dd. Always the trade (contract) date, never settlement. */
export type IsoDate = string;

export interface SourceRef {
  broker: Broker;
  file: string;
  /** Where in the file, e.g. "Closed Positions, row 14". */
  locator: string;
}

/** A single buy or sell from a raw trade list (CMC Invest, generic CSV, manual entry). */
export interface Trade {
  id: string;
  broker: Broker;
  date: IsoDate;
  side: 'buy' | 'sell';
  symbol: string;
  name?: string;
  units: number;
  /** Price per unit in `currency`, before fees. */
  price: number;
  currency: string;
  /** Brokerage and other fees in `currency` (positive number). */
  fees: number;
  assetClass: AssetClass;
  source: SourceRef;
}

/**
 * A position the broker has already matched open to close (eToro works this
 * way: every closed position carries its own open date and invested amount).
 */
export interface ClosedPosition {
  id: string;
  broker: Broker;
  symbol: string;
  name?: string;
  /** What the broker calls it. Classification for tax happens in the engine. */
  brokerType: string;
  assetClass: AssetClass;
  openDate: IsoDate;
  closeDate: IsoDate;
  units: number;
  isShort: boolean;
  leverage: number;
  currency: string;
  /** Amount invested (cost, including any opening fees) in `currency`. */
  invested: number;
  /** Realised profit or loss in `currency`, as the broker reports it. */
  profit: number;
  /** Overnight / financing fees and dividend adjustments, signed, in `currency`. */
  financing: number;
  isin?: string;
  source: SourceRef;
}

export type IncomeKind = 'dividend' | 'interest';

export interface IncomeEvent {
  id: string;
  broker: Broker;
  kind: IncomeKind;
  date: IsoDate;
  symbol?: string;
  name?: string;
  /** 'AU' for Australian-sourced income, otherwise the ISO country or 'foreign'. */
  country: string;
  currency: string;
  /** Cash actually received, after withholding. */
  netAmount: number;
  /** Foreign or TFN tax withheld, in `currency`. */
  withholding: number;
  /** Australian dividends only. */
  frankedAmount?: number;
  unfrankedAmount?: number;
  frankingCredit?: number;
  source: SourceRef;
}

/**
 * A figure the broker has already calculated against a myTax label, e.g. a
 * Stockspot annual tax statement. Passed through unchanged, with its source.
 */
export interface ReportedFigure {
  label: string;
  amount: number;
  description: string;
  source: SourceRef;
}

/**
 * Capital gain components a broker or fund has reported (Stockspot realised
 * gains, ETF/AMMA statements). Amounts are AUD. Discount gains are grossed up
 * (before the 50% discount).
 */
export interface ReportedCapitalGains {
  discountGainsGross: number;
  otherGains: number;
  capitalLosses: number;
  description: string;
  /** True when components were derived from 18H/18A rather than stated. */
  derived: boolean;
  source: SourceRef;
}

export interface ParseWarning {
  file: string;
  message: string;
}

export interface Ledger {
  trades: Trade[];
  closedPositions: ClosedPosition[];
  income: IncomeEvent[];
  reported: ReportedFigure[];
  reportedCapitalGains: ReportedCapitalGains[];
  warnings: ParseWarning[];
  /** Which documents were read, for the documents checklist. */
  documents: { file: string; broker: Broker; kind: string; period?: { from: IsoDate; to: IsoDate } }[];
}

export function emptyLedger(): Ledger {
  return { trades: [], closedPositions: [], income: [], reported: [], reportedCapitalGains: [], warnings: [], documents: [] };
}

export function mergeLedgers(...ledgers: Ledger[]): Ledger {
  const out = emptyLedger();
  for (const l of ledgers) {
    out.trades.push(...l.trades);
    out.closedPositions.push(...l.closedPositions);
    out.income.push(...l.income);
    out.reported.push(...l.reported);
    out.reportedCapitalGains.push(...l.reportedCapitalGains);
    out.warnings.push(...l.warnings);
    out.documents.push(...l.documents);
  }
  return out;
}
