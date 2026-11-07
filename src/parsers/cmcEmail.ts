/**
 * CMC Invest notification emails. CMC sends an "Order filled" email for every
 * fill and a dividend notice for every dividend, so a mailbox holds a full
 * trade history even when the user has not downloaded a statement.
 *
 * Brokerage is not in the "Order filled" email (it is on the PDF trade
 * confirmation), so trades from emails carry zero fees and a warning.
 */
import type { IncomeEvent, Ledger, Trade } from '../model';
import { emptyLedger } from '../model';

export interface EmailText {
  id: string;
  subject: string;
  body: string;
}

const FILL_RE = /order to (buy|sell) ([\d.,]+) ([A-Z0-9./]+?)(?::([A-Z]{2}))? at ([\d.,]+) ([A-Z]{3}) was filled on (\d{2})\/(\d{2})\/(\d{4})/i;

function cellValue(body: string, label: string): string | null {
  const m = new RegExp(`\\|\\s*${label}\\s*\\|\\s*([^|]+?)\\s*\\|`, 'i').exec(body);
  return m ? m[1]!.trim() : null;
}

function money(v: string | null): { ccy: string; amount: number } | null {
  if (!v) return null;
  const m = /^([A-Z]{3})\s+(-?[\d.,]+)$/.exec(v);
  return m ? { ccy: m[1]!, amount: Number(m[2]!.replace(/,/g, '')) } : null;
}

function dmy(v: string | null): string | null {
  const m = v && /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseCmcEmails(emails: EmailText[], file = 'CMC Invest emails'): Ledger {
  const out = emptyLedger();
  out.documents.push({ file, broker: 'cmc-invest', kind: 'Order filled and dividend emails' });
  let fills = 0;
  for (const e of emails) {
    const text = `${e.subject}\n${e.body}`;
    const f = FILL_RE.exec(text);
    if (f && /filled/i.test(e.subject)) {
      fills++;
      const [, side, units, sym, mkt, price, ccy, d, m, y] = f;
      const t: Trade = {
        id: `cmc-invest:email:${e.id}`,
        broker: 'cmc-invest',
        date: `${y}-${m}-${d}`,
        side: side!.toLowerCase() as 'buy' | 'sell',
        symbol: sym!.toUpperCase(),
        units: Number(units!.replace(/,/g, '')),
        price: Number(price!.replace(/,/g, '')),
        currency: ccy!.toUpperCase(),
        fees: 0,
        assetClass: 'share',
        source: { broker: 'cmc-invest', file, locator: `email "${e.subject.trim()}"` },
      };
      if (mkt) t.name = `${t.symbol} (${mkt})`;
      out.trades.push(t);
      continue;
    }
    const div = /Dividend(?: Adjustment)? On:\s*([A-Z0-9./]+)(?::([A-Z]{2}))?/i.exec(text);
    if (div) {
      const date = dmy(cellValue(text, 'Pay Date'));
      const gross = money(cellValue(text, 'Gross Amount'));
      const tax = money(cellValue(text, 'Tax Withheld'));
      if (!date || !gross) {
        out.warnings.push({ file, message: `Dividend email "${e.subject}" could not be read.` });
        continue;
      }
      const ev: IncomeEvent = {
        id: `cmc-invest:div:${e.id}`,
        broker: 'cmc-invest',
        kind: 'dividend',
        date,
        symbol: div[1]!.toUpperCase(),
        country: div[2] ? div[2].toUpperCase() : 'AU',
        currency: gross.ccy,
        netAmount: gross.amount - (tax?.amount ?? 0),
        withholding: tax?.amount ?? 0,
        source: { broker: 'cmc-invest', file, locator: `email "${e.subject.trim()}"` },
      };
      out.income.push(ev);
    }
  }
  if (fills) out.warnings.push({ file, message: `${fills} trades came from "Order filled" emails, which do not show brokerage. Brokerage is on each PDF trade confirmation; add it if you paid any.` });
  return out;
}
