import { describe, expect, it } from 'vitest';
import { parseCmcEmails } from '../src/parsers/cmcEmail';
import { computeReturn } from '../src/engine/compute';
import { flatFx } from './helpers';

const fill = (id: string, side: string, n: number, sym: string, px: number, ccy: string, date: string) => ({
  id,
  subject: `Order filled: ${side.toUpperCase()} ${n} ${sym} at ${px} ${ccy} - Account: 0000000`,
  body: `Dear Investor, Your order to ${side} ${n} ${sym} at ${px} ${ccy} was filled on ${date} at 06:00:04 PM.`,
});

const dividend = {
  id: 'd1',
  subject: 'MSFT:US Dividend - 0000000 SAMPLE INVESTOR Notification',
  body: 'Dividend On: MSFT:US\n| Pay Date | 11/06/2026 |\n| Ex Date | 21/05/2026 |\n| Gross Amount | USD 0.91 |\n| Fees | USD 0.00 |\n| Tax Withheld | USD 0.27 |\n| Net amount (Local) | USD 0.64 |',
};

describe('CMC Invest emails', () => {
  const l = parseCmcEmails([
    fill('1', 'buy', 2, 'VOO:US', 663.11, 'USD', '04/05/2026'),
    fill('2', 'buy', 17, 'NDQ', 56.95, 'AUD', '05/05/2026'),
    fill('3', 'sell', 2, 'VOO:US', 681.04, 'USD', '30/06/2026'),
    fill('4', 'sell', 17, 'NDQ', 62.75, 'AUD', '30/06/2026'),
    dividend,
  ]);
  it('reads fills and dividends', () => {
    expect(l.trades.map((t) => [t.side, t.symbol, t.units, t.price, t.currency, t.date])).toEqual([
      ['buy', 'VOO', 2, 663.11, 'USD', '2026-05-04'],
      ['buy', 'NDQ', 17, 56.95, 'AUD', '2026-05-05'],
      ['sell', 'VOO', 2, 681.04, 'USD', '2026-06-30'],
      ['sell', 'NDQ', 17, 62.75, 'AUD', '2026-06-30'],
    ]);
    expect(l.income[0]).toMatchObject({ symbol: 'MSFT', country: 'US', netAmount: 0.64, withholding: 0.27, date: '2026-06-11' });
    expect(l.warnings[0]!.message).toMatch(/brokerage/);
  });
  it('feeds the engine', () => {
    const r = computeReturn(l, 2026, flatFx());
    expect(r.figures.find((f) => f.code === '18H')!.value).toBe(cents((681.04 - 663.11) * 2 * 2 + (62.75 - 56.95) * 17));
    expect(r.figures.find((f) => f.code === '20E')!.value).toBe(1.82);
  });
});
const cents = (n: number) => Math.round(n * 100) / 100;
