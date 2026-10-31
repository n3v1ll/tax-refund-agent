import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadFile } from '../src/io/load';
import { mergeLedgers } from '../src/model';
import { computeReturn } from '../src/engine/compute';
import { isoDate, num } from '../src/io/table';
import { flatFx } from './helpers';

const read = (f: string) => new Uint8Array(readFileSync(`test/fixtures/${f}`));

describe('cell parsing', () => {
  it('reads Australian number formats', () => {
    expect(num('$1,234.56')).toBe(1234.56);
    expect(num('(12.30)')).toBe(-12.3);
    expect(num('-')).toBeNull();
    expect(num('USD 5.00')).toBe(5);
  });
  it('reads day-first dates and converts UTC times to Sydney', () => {
    expect(isoDate('03/09/2025')).toBe('2025-09-03');
    expect(isoDate('30/06/2026 23:30:00', 'Australia/Sydney')).toBe('2026-07-01');
    expect(isoDate('30/06/2026 10:00:00', 'Australia/Sydney')).toBe('2026-06-30');
    expect(isoDate('2-Jan-2026')).toBe('2026-01-02');
  });
});

describe('eToro account statement', async () => {
  const { ledger, detected } = await loadFile('etoro-account-statement-sample.xlsx', read('etoro-account-statement-sample.xlsx'));
  it('is detected', () => expect(detected).toBe('eToro account statement'));
  it('reads closed positions and dividends', () => {
    expect(ledger.closedPositions.filter((p) => !p.id.includes('divadj'))).toHaveLength(7);
    expect(ledger.income).toHaveLength(3);
    expect(ledger.documents[0]!.period).toEqual({ from: '2025-07-01', to: '2026-06-30' });
    const apple = ledger.closedPositions.find((p) => p.id === 'etoro:2101')!;
    expect(apple).toMatchObject({ openDate: '2024-03-16', closeDate: '2025-08-21', invested: 1500, profit: 700, leverage: 1, isShort: false });
    const nflx = ledger.closedPositions.find((p) => p.id === 'etoro:2105')!;
    expect(nflx.isShort).toBe(true);
  });
  it('treats CFD dividend adjustments as part of the CFD result', () => {
    expect(ledger.closedPositions.some((p) => p.id.includes('divadj') && p.brokerType === 'CFD')).toBe(true);
  });
  it('produces myTax figures', () => {
    const r = computeReturn(ledger, 2026, flatFx());
    const v = (c: string) => r.figures.find((f) => f.code === c)!.value;
    // US$1 = A$2. Apple +700 (discount), Tesla -400, SPY +300 (no discount)
    expect(v('18H')).toBe(2000);
    // losses 800 against SPY 600 first, then 200 against Apple 1400 -> 1200 * 50%
    expect(v('18A')).toBe(600);
    // CFDs: (250 - 12.5) + (60 - 3) + 0.17 = 294.67 USD
    expect(v('24Y')).toBe(589.34);
    expect(v('20E')).toBe(35.02);
    expect(v('20O')).toBe(5.26);
    expect(r.issues.some((i) => i.code === 'CRYPTO')).toBe(true);
    expect(r.issues.some((i) => i.code === 'OUTSIDE_YEAR')).toBe(true);
  });
});

describe('CMC Invest trade list', async () => {
  const { ledger, detected } = await loadFile('cmc-invest-trades-sample.csv', read('cmc-invest-trades-sample.csv'));
  it('is detected', () => expect(detected).toBe('CMC Invest trade list'));
  it('reads trades with fees and currency', () => {
    expect(ledger.trades).toHaveLength(6);
    expect(ledger.trades[0]).toMatchObject({ date: '2024-02-12', side: 'buy', symbol: 'VAS', units: 50, price: 92.1, fees: 10, currency: 'AUD' });
    expect(ledger.trades.find((t) => t.symbol === 'AAPL')!.currency).toBe('USD');
  });
  it('matches parcels and asks for the missing AAPL purchase', () => {
    const r = computeReturn(ledger, 2026, flatFx());
    const vas = r.disposals.filter((d) => d.symbol === 'VAS');
    // FIFO: 50 from Feb 2024 (discount), 10 from Sep 2025
    expect(vas.map((d) => d.units)).toEqual([50, 10]);
    expect(vas[0]!.discountEligible).toBe(true);
    expect(r.issues.find((i) => i.code === 'MISSING_COST_BASE')?.message).toMatch(/5 AAPL/);
  });
});

describe('Stockspot annual tax statement', async () => {
  const { ledger, detected } = await loadFile('stockspot-annual-tax-statement-sample.pdf', read('stockspot-annual-tax-statement-sample.pdf'));
  it('is detected', () => expect(detected).toBe('Stockspot annual tax statement'));
  it('passes labelled figures through', () => {
    const byLabel = Object.fromEntries(ledger.reported.map((f) => [f.label, f.amount]));
    expect(byLabel).toMatchObject({ '13U': 412.36, '13C': 198.2, '13Q': 61.14, '20E': 95.4, '20M': 95.4, '20O': 12.85 });
    expect(ledger.reportedCapitalGains).toEqual([expect.objectContaining({ discountGainsGross: 1040, otherGains: 200, derived: false })]);
  });
  it('combines with other brokers', () => {
    const r = computeReturn(ledger, 2026, flatFx());
    const v = (c: string) => r.figures.find((f) => f.code === c)!.value;
    expect(v('18H')).toBe(1240);
    expect(v('18A')).toBe(720);
    expect(v('13U')).toBe(412.36);
  });
});

describe('all three brokers together', async () => {
  const files = ['etoro-account-statement-sample.xlsx', 'cmc-invest-trades-sample.csv', 'stockspot-annual-tax-statement-sample.pdf'];
  const ledgers = await Promise.all(files.map(async (f) => (await loadFile(f, read(f))).ledger));
  it('adds up across brokers', () => {
    const r = computeReturn(mergeLedgers(...ledgers), 2026, flatFx());
    const v = (c: string) => r.figures.find((f) => f.code === c)!.value;
    expect(v('20E')).toBe(130.42);
    expect(v('18G')).toBe(true);
    expect(r.figures.find((f) => f.code === '18A')!.blockedBy.length).toBe(1);
  });
});
