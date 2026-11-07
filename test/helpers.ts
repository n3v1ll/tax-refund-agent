import type { ClosedPosition, IncomeEvent, Ledger, Trade } from '../src/model';
import { emptyLedger } from '../src/model';
import type { FxTable } from '../src/engine/fx';

/** Flat USD rate of 0.5 (A$1 = US$0.50) for every day 2023-2026, so US$1 = A$2. */
export function flatFx(rate = 0.5): FxTable {
  const usd: Record<string, number> = {};
  for (let t = Date.parse('2023-01-01'); t <= Date.parse('2026-12-31'); t += 86400000) {
    const d = new Date(t);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // RBA publishes business days only
    usd[d.toISOString().slice(0, 10)] = rate;
  }
  return { rates: { USD: usd }, source: 'test' };
}

const src = (file = 'test') => ({ broker: 'generic' as const, file, locator: 'row' });

export function trade(p: Partial<Trade> & Pick<Trade, 'date' | 'side' | 'symbol' | 'units' | 'price'>): Trade {
  return { id: `${p.symbol}-${p.side}-${p.date}-${p.units}`, broker: 'cmc-invest', currency: 'AUD', fees: 0, assetClass: 'share', source: src(), ...p };
}

export function position(p: Partial<ClosedPosition> & Pick<ClosedPosition, 'id' | 'openDate' | 'closeDate' | 'invested' | 'profit'>): ClosedPosition {
  return { broker: 'etoro', symbol: 'AAPL', brokerType: 'Stocks', assetClass: 'share', units: 1, isShort: false, leverage: 1, currency: 'USD', financing: 0, source: src(), ...p };
}

export function income(p: Partial<IncomeEvent> & Pick<IncomeEvent, 'id' | 'date' | 'netAmount'>): IncomeEvent {
  return { broker: 'etoro', kind: 'dividend', country: 'US', currency: 'USD', withholding: 0, source: src(), ...p };
}

export function ledger(parts: Partial<Ledger>): Ledger {
  return { ...emptyLedger(), ...parts };
}
