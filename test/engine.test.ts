import { describe, expect, it } from 'vitest';
import { computeReturn } from '../src/engine/compute';
import { discountEligible } from '../src/engine/util';
import { flatFx, income, ledger, position, trade } from './helpers';

const fx = flatFx();
const fig = (r: ReturnType<typeof computeReturn>, code: string) => r.figures.find((f) => f.code === code)!.value;

describe('12-month rule', () => {
  it('excludes the day of purchase and day of sale', () => {
    expect(discountEligible('2024-01-01', '2025-01-01')).toBe(false);
    expect(discountEligible('2024-01-01', '2025-01-02')).toBe(true);
    expect(discountEligible('2024-02-29', '2025-03-01')).toBe(true);
    expect(discountEligible('2024-02-29', '2025-02-28')).toBe(false);
  });
});

describe('capital gains', () => {
  it('applies losses to non-discount gains first, then the 50% discount', () => {
    const l = ledger({
      trades: [
        // Discount gain of 4000 (held > 12 months)
        trade({ symbol: 'BHP', side: 'buy', date: '2023-07-03', units: 100, price: 10 }),
        trade({ symbol: 'BHP', side: 'sell', date: '2025-08-01', units: 100, price: 50 }),
        // Non-discount gain of 1000
        trade({ symbol: 'CBA', side: 'buy', date: '2025-07-10', units: 10, price: 100 }),
        trade({ symbol: 'CBA', side: 'sell', date: '2025-12-01', units: 10, price: 200 }),
        // Loss of 1500
        trade({ symbol: 'ZIP', side: 'buy', date: '2025-07-15', units: 1000, price: 2 }),
        trade({ symbol: 'ZIP', side: 'sell', date: '2026-01-15', units: 1000, price: 0.5 }),
      ],
    });
    const r = computeReturn(l, 2026, fx);
    expect(fig(r, '18G')).toBe(true);
    expect(fig(r, '18H')).toBe(5000);
    // (1000 - 1000) + (4000 - 500) * 50% = 1750
    expect(fig(r, '18A')).toBe(1750);
    expect(fig(r, '18V')).toBe(0);
    expect(r.issues.filter((i) => i.severity === 'blocker')).toEqual([]);
  });

  it('includes brokerage in cost base and deducts it from proceeds', () => {
    const r = computeReturn(ledger({ trades: [
      trade({ symbol: 'VAS', side: 'buy', date: '2025-07-01', units: 10, price: 100, fees: 10 }),
      trade({ symbol: 'VAS', side: 'sell', date: '2025-09-01', units: 10, price: 110, fees: 10 }),
    ] }), 2026, fx);
    expect(fig(r, '18H')).toBe(80);
    expect(fig(r, '18A')).toBe(80);
  });

  it('matches FIFO across parcels and splits a sale that straddles 12 months', () => {
    const r = computeReturn(ledger({ trades: [
      trade({ symbol: 'NDQ', side: 'buy', date: '2024-01-10', units: 10, price: 30 }),
      trade({ symbol: 'NDQ', side: 'buy', date: '2025-10-10', units: 10, price: 40 }),
      trade({ symbol: 'NDQ', side: 'sell', date: '2026-03-02', units: 15, price: 50 }),
    ] }), 2026, fx);
    expect(r.disposals).toHaveLength(2);
    expect(r.disposals[0]!.discountEligible).toBe(true);
    expect(r.disposals[0]!.gainAud).toBe(200);
    expect(r.disposals[1]!.discountEligible).toBe(false);
    expect(r.disposals[1]!.gainAud).toBe(50);
    expect(fig(r, '18H')).toBe(250);
    expect(fig(r, '18A')).toBe(150);
  });

  it('lowest-tax method prefers the parcel with the smallest taxable gain', () => {
    const l = ledger({ trades: [
      trade({ symbol: 'XYZ', side: 'buy', date: '2025-07-01', units: 10, price: 10 }),
      trade({ symbol: 'XYZ', side: 'buy', date: '2025-08-01', units: 10, price: 60 }),
      trade({ symbol: 'XYZ', side: 'sell', date: '2025-09-01', units: 10, price: 50 }),
    ] });
    expect(fig(computeReturn(l, 2026, fx, { parcelMethod: 'fifo' }), '18A')).toBe(400);
    const low = computeReturn(l, 2026, fx, { parcelMethod: 'lowest_tax' });
    expect(fig(low, '18A')).toBe(0);
    expect(fig(low, '18V')).toBe(100);
  });

  it('sales before the year still use up parcels', () => {
    const r = computeReturn(ledger({ trades: [
      trade({ symbol: 'A2M', side: 'buy', date: '2024-07-01', units: 10, price: 5 }),
      trade({ symbol: 'A2M', side: 'buy', date: '2025-07-02', units: 10, price: 8 }),
      trade({ symbol: 'A2M', side: 'sell', date: '2025-01-01', units: 10, price: 6 }),
      trade({ symbol: 'A2M', side: 'sell', date: '2025-08-01', units: 10, price: 9 }),
    ] }), 2026, fx);
    expect(r.disposals).toHaveLength(1);
    expect(fig(r, '18H')).toBe(10);
  });

  it('asks for the missing purchase when a sale has no matching buy', () => {
    const r = computeReturn(ledger({ trades: [trade({ symbol: 'AAPL', side: 'sell', date: '2025-09-01', units: 20, price: 300, currency: 'USD' })] }), 2026, fx);
    const blocker = r.issues.find((i) => i.code === 'MISSING_COST_BASE');
    expect(blocker?.ask).toMatch(/earlier CMC Invest statement/);
    expect(r.figures.find((f) => f.code === '18A')!.blockedBy).toContain(blocker!.id);
  });

  it('carries forward unused prior-year losses', () => {
    const r = computeReturn(ledger({ trades: [
      trade({ symbol: 'CBA', side: 'buy', date: '2025-07-10', units: 1, price: 100 }),
      trade({ symbol: 'CBA', side: 'sell', date: '2025-12-01', units: 1, price: 300 }),
    ] }), 2026, fx, { priorYearLosses: 500 });
    expect(fig(r, '18H')).toBe(200);
    expect(fig(r, '18A')).toBe(0);
    expect(fig(r, '18V')).toBe(300);
  });

  it('converts USD legs at the rate on each date', () => {
    const fx2 = flatFx(0.5);
    fx2.rates.USD!['2026-02-02'] = 0.8; // AUD stronger at sale
    const r = computeReturn(ledger({ closedPositions: [position({ id: 'p1', openDate: '2025-08-01', closeDate: '2026-02-02', invested: 1000, profit: 200 })] }), 2026, fx2);
    // cost 1000/0.5 = 2000 AUD; proceeds 1200/0.8 = 1500 AUD -> capital loss despite USD profit
    expect(r.disposals[0]!.gainAud).toBe(-500);
    expect(fig(r, '18V')).toBe(500);
  });

  it('uses the previous business day rate on weekends', () => {
    const r = computeReturn(ledger({ closedPositions: [position({ id: 'p1', openDate: '2025-08-02', closeDate: '2025-08-09', invested: 100, profit: 10 })] }), 2026, fx);
    expect(r.disposals[0]!.gainAud).toBe(20);
  });

  it('blocks when no exchange rate is loaded', () => {
    const r = computeReturn(ledger({ closedPositions: [position({ id: 'p1', openDate: '2025-08-01', closeDate: '2025-09-01', invested: 100, profit: 10 })] }), 2026, { rates: {}, source: 'none' });
    expect(r.issues.some((i) => i.code === 'FX_MISSING')).toBe(true);
    expect(r.figures.find((f) => f.code === '18H')!.blockedBy.length).toBeGreaterThan(0);
  });
});

describe('eToro classification and CFDs', () => {
  it('treats leveraged, short and CFD-labelled positions as other income', () => {
    const r = computeReturn(ledger({ closedPositions: [
      position({ id: 'lev', openDate: '2025-08-01', closeDate: '2025-08-20', invested: 100, profit: 50, leverage: 5 }),
      position({ id: 'short', openDate: '2025-08-01', closeDate: '2025-08-20', invested: 100, profit: 25, isShort: true }),
      position({ id: 'cfd', openDate: '2025-08-01', closeDate: '2025-08-20', invested: 100, profit: 10, brokerType: 'CFD', financing: -5 }),
      position({ id: 'real', openDate: '2025-08-01', closeDate: '2025-08-20', invested: 100, profit: 10 }),
    ] }), 2026, fx);
    expect(fig(r, '24Y')).toBe((50 + 25 + 10 - 5) * 2);
    expect(fig(r, '18H')).toBe(20);
    expect(r.classifications.find((c) => c.positionId === 'lev')!.assetClass).toBe('cfd');
  });

  it('lets the user override a classification', () => {
    const r = computeReturn(ledger({ closedPositions: [position({ id: 'x', openDate: '2025-08-01', closeDate: '2025-08-20', invested: 100, profit: 50, isShort: true })] }), 2026, fx, { classificationOverrides: { x: 'share' } });
    expect(fig(r, '24Y')).toBe(0);
    expect(fig(r, '18H')).toBe(100);
  });

  it('flags a net CFD loss instead of claiming it', () => {
    const r = computeReturn(ledger({ closedPositions: [position({ id: 'c', brokerType: 'CFD', openDate: '2025-08-01', closeDate: '2025-08-20', invested: 100, profit: -40 })] }), 2026, fx);
    expect(fig(r, '24Y')).toBe(0);
    expect(r.issues.some((i) => i.code === 'CFD_NET_LOSS' && i.severity === 'out_of_scope')).toBe(true);
  });

  it('leaves crypto out and says so', () => {
    const r = computeReturn(ledger({ closedPositions: [position({ id: 'btc', brokerType: 'Crypto', openDate: '2025-08-01', closeDate: '2025-08-20', invested: 100, profit: 40 })] }), 2026, fx);
    expect(fig(r, '18H')).toBe(0);
    expect(r.issues.some((i) => i.code === 'CRYPTO')).toBe(true);
  });
});

describe('income', () => {
  it('grosses up foreign dividends and claims withholding at 20O', () => {
    const r = computeReturn(ledger({ income: [income({ id: 'd1', date: '2025-11-14', netAmount: 85, withholding: 15 })] }), 2026, fx);
    expect(fig(r, '20E')).toBe(200);
    expect(fig(r, '20M')).toBe(200);
    expect(fig(r, '20O')).toBe(30);
  });

  it('caps 20O at $1,000 and warns', () => {
    const r = computeReturn(ledger({ income: [income({ id: 'd1', date: '2025-11-14', netAmount: 3400, withholding: 600 })] }), 2026, fx);
    expect(fig(r, '20O')).toBe(1000);
    expect(r.issues.some((i) => i.code === 'FITO_LIMIT')).toBe(true);
  });

  it('splits Australian dividends into 11S, 11T and 11U', () => {
    const r = computeReturn(ledger({ income: [income({ id: 'a', date: '2025-09-30', country: 'AU', currency: 'AUD', netAmount: 100, frankedAmount: 70, unfrankedAmount: 30, frankingCredit: 30 })] }), 2026, fx);
    expect([fig(r, '11S'), fig(r, '11T'), fig(r, '11U')]).toEqual([30, 70, 30]);
  });

  it('asks for the dividend statement when franking is unknown', () => {
    const r = computeReturn(ledger({ income: [income({ id: 'a', date: '2025-09-30', country: 'AU', currency: 'AUD', netAmount: 100 })] }), 2026, fx);
    expect(r.issues.find((i) => i.code === 'FRANKING_MISSING')?.ask).toMatch(/dividend statement/);
  });

  it('ignores items outside the income year', () => {
    const r = computeReturn(ledger({ income: [income({ id: 'old', date: '2025-06-30', netAmount: 10 })] }), 2026, fx);
    expect(fig(r, '20E')).toBe(0);
    expect(r.issues.some((i) => i.code === 'OUTSIDE_YEAR')).toBe(true);
  });
});

describe('reported figures', () => {
  it('adds pass-through capital gains into the combined calculation', () => {
    const r = computeReturn(ledger({
      reportedCapitalGains: [{ discountGainsGross: 1000, otherGains: 200, capitalLosses: 0, description: 'Stockspot', derived: false, source: { broker: 'stockspot', file: 's.pdf', locator: 'p1' } }],
      trades: [
        trade({ symbol: 'ZIP', side: 'buy', date: '2025-07-15', units: 100, price: 5 }),
        trade({ symbol: 'ZIP', side: 'sell', date: '2026-01-15', units: 100, price: 2 }),
      ],
    }), 2026, fx);
    expect(fig(r, '18H')).toBe(1200);
    // loss 300 against other 200 first, then 100 against discount: 900 * 0.5 = 450
    expect(fig(r, '18A')).toBe(450);
  });
});

describe('missing exchange rates', () => {
  it('does not claim a purchase is missing when only its rate is', () => {
    const r = computeReturn(ledger({ trades: [
      trade({ symbol: 'VOO', side: 'buy', date: '2026-05-04', units: 2, price: 600, currency: 'USD' }),
      trade({ symbol: 'VOO', side: 'sell', date: '2026-06-30', units: 2, price: 650, currency: 'USD' }),
    ] }), 2026, { rates: {}, source: 'none' });
    expect(r.issues.some((i) => i.code === 'MISSING_COST_BASE')).toBe(false);
    expect(r.issues.some((i) => i.code === 'FX_MISSING')).toBe(true);
    expect(r.disposals).toHaveLength(0);
  });
});
