/**
 * Which documents to download from each broker, and how we tell that one has
 * been loaded. Menu paths are our best understanding and should be checked
 * against each broker's current site every July.
 */
import type { Ledger } from '../model';

export type BrokerKey = 'etoro' | 'cmc-invest' | 'stockspot' | 'other';

export interface DocRequest {
  id: string;
  broker: BrokerKey;
  title: string;
  why: string;
  where: string;
  format: string;
  required: boolean;
  /** True once a loaded document satisfies this request. */
  satisfiedBy: (l: Ledger) => boolean;
}

export const BROKER_NAMES: Record<BrokerKey, string> = {
  etoro: 'eToro',
  'cmc-invest': 'CMC Invest',
  stockspot: 'Stockspot',
  other: 'Another broker',
};

export function documentRequests(brokers: BrokerKey[], year: { start: string; end: string }): DocRequest[] {
  const out: DocRequest[] = [];
  const fy = `${year.start.slice(0, 4)}-${year.end.slice(2, 4)}`;
  if (brokers.includes('etoro')) {
    out.push({
      id: 'etoro-statement',
      broker: 'etoro',
      title: `eToro account statement for 1 July ${year.start.slice(0, 4)} to 30 June ${year.end.slice(0, 4)}`,
      why: 'Lists every closed position (shares, ETFs, CFDs, crypto) with its open date, amount invested and profit, plus dividends and the tax withheld on them.',
      where: 'In eToro on the web: Settings > Account > Account statement (or Portfolio > History > Account statement). Pick the date range, then download the Excel (XLSX) version, not the PDF.',
      format: 'Excel (.xlsx)',
      required: true,
      satisfiedBy: (l) => l.documents.some((d) => d.broker === 'etoro'),
    });
  }
  if (brokers.includes('cmc-invest')) {
    out.push({
      id: 'cmc-trades',
      broker: 'cmc-invest',
      title: 'CMC Invest trade history from your first purchase to 30 June',
      why: 'CMC Invest does not calculate capital gains. To work out the gain on a sale we need the purchase of the same shares, which may be in an earlier year.',
      where: 'In CMC Invest: Account > Reports (or Statements) > Trade history / Transaction history. Choose a start date before your first purchase and export as CSV or Excel. The EOFY Trading Statement PDF covers only one year.',
      format: 'CSV or Excel',
      required: true,
      satisfiedBy: (l) => l.documents.some((d) => d.broker === 'cmc-invest'),
    });
    out.push({
      id: 'cmc-dividends',
      broker: 'cmc-invest',
      title: 'Dividend statements for ASX shares held with CMC Invest',
      why: 'Franking credits come from the share registry statement, not the broker. Enter them with the income template if you have any.',
      where: 'From each company\'s share registry (Computershare, MUFG/Link, Automic, BoardRoom) or the ATO pre-fill report in myTax, which usually lists them.',
      format: 'Our income CSV template',
      required: false,
      satisfiedBy: (l) => l.income.some((e) => e.country === 'AU' && e.kind === 'dividend'),
    });
  }
  if (brokers.includes('stockspot')) {
    out.push({
      id: 'stockspot-tax',
      broker: 'stockspot',
      title: `Stockspot Annual Tax Statement ${fy}`,
      why: 'Stockspot already works out its figures against myTax labels, including capital gains and ETF distributions. We read them and add them to your other brokers.',
      where: 'Stockspot dashboard > Reports (or Documents) > Tax. Usually available from late August.',
      format: 'PDF',
      required: true,
      satisfiedBy: (l) => l.documents.some((d) => d.broker === 'stockspot'),
    });
  }
  if (brokers.includes('other')) {
    out.push({
      id: 'other-trades',
      broker: 'other',
      title: 'Trades from any other broker, in our CSV template',
      why: 'For brokers we do not read yet. One row per buy or sell.',
      where: 'Export the trade history from your broker and copy it into the template.',
      format: 'CSV',
      required: false,
      satisfiedBy: (l) => l.documents.some((d) => d.broker === 'generic'),
    });
  }
  return out;
}
