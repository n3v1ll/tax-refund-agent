/**
 * eToro account statement (XLSX, "Account statement" download for a date range).
 *
 * Sheets used: "Closed Positions", "Dividends", "Account Summary" (period).
 * Column names are matched loosely because eToro renames them every so often.
 * eToro timestamps are UTC; dates are converted to Australia/Sydney so a US
 * trade on the evening of 30 June UTC lands in the right income year.
 *
 * Assumptions to verify against a real statement: see docs/brokers.md.
 */
import type { ClosedPosition, Ledger, AssetClass } from '../model';
import { emptyLedger } from '../model';
import { cell, findHeader, findSheet, isoDate, num, str, type ColumnSpec, type Sheet } from '../io/table';

export const ETORO_TZ = 'Australia/Sydney';

const CLOSED: ColumnSpec<'id' | 'action' | 'longShort' | 'amount' | 'units' | 'openDate' | 'closeDate' | 'leverage' | 'profitUsd' | 'profit' | 'financing' | 'type' | 'isin' | 'openRate' | 'closeRate'> = {
  id: { aliases: ['position id', 'position'], required: true },
  action: { aliases: ['action', 'instrument', 'details'] },
  longShort: { aliases: ['long / short', 'long short', 'direction'] },
  amount: { aliases: ['amount', 'invested', 'amount usd'], required: true },
  units: { aliases: ['units / contracts', 'units', 'contracts'] },
  openDate: { aliases: ['open date', 'opened'], required: true },
  closeDate: { aliases: ['close date', 'closed'], required: true },
  leverage: { aliases: ['leverage'] },
  profitUsd: { aliases: ['profit usd', 'profit(usd)', 'net profit usd'] },
  profit: { aliases: ['profit', 'net profit'] },
  financing: { aliases: ['overnight fees and dividends', 'rollover fees and dividends', 'overnight fees', 'rollover fees'] },
  type: { aliases: ['type', 'asset type', 'instrument type'] },
  isin: { aliases: ['isin'] },
  openRate: { aliases: ['open rate'] },
  closeRate: { aliases: ['close rate'] },
};

const DIVS: ColumnSpec<'date' | 'name' | 'net' | 'withholding' | 'rate' | 'positionId' | 'type' | 'isin'> = {
  date: { aliases: ['date of payment', 'payment date', 'date'], required: true },
  name: { aliases: ['instrument name', 'instrument'] },
  net: { aliases: ['net dividend received usd', 'net dividend received', 'net dividend'], required: true },
  withholding: { aliases: ['withholding tax amount usd', 'withholding tax amount', 'withholding tax'] },
  rate: { aliases: ['withholding tax rate %', 'withholding tax rate'] },
  positionId: { aliases: ['position id'] },
  type: { aliases: ['type'] },
  isin: { aliases: ['isin'] },
};

export function isEtoroStatement(sheets: Sheet[]): boolean {
  return !!findSheet(sheets, 'Closed Positions') && (!!findSheet(sheets, 'Account Summary') || !!findSheet(sheets, 'Account Activity') || !!findSheet(sheets, 'Dividends'));
}

export function parseEtoro(file: string, sheets: Sheet[]): Ledger {
  const out = emptyLedger();
  const period = readPeriod(sheets);
  out.documents.push({ file, broker: 'etoro', kind: 'Account statement', period });

  const closed = findSheet(sheets, 'Closed Positions');
  if (!closed) {
    out.warnings.push({ file, message: 'No "Closed Positions" sheet found. Is this the eToro account statement (Excel)?' });
  } else {
    const h = findHeader(closed.rows, CLOSED);
    if (!h) out.warnings.push({ file, message: 'Could not find the column headings in "Closed Positions".' });
    else {
      for (let r = h.headerRow + 1; r < closed.rows.length; r++) {
        const row = closed.rows[r]!;
        const id = str(cell(row, h, 'id'));
        if (!id || /total/i.test(id)) continue;
        const openDate = isoDate(cell(row, h, 'openDate'), ETORO_TZ);
        const closeDate = isoDate(cell(row, h, 'closeDate'), ETORO_TZ);
        const invested = num(cell(row, h, 'amount'));
        const profit = num(cell(row, h, 'profitUsd')) ?? num(cell(row, h, 'profit'));
        const locator = `Closed Positions, row ${r + 1}`;
        if (!openDate || !closeDate || invested === null || profit === null) {
          out.warnings.push({ file, message: `${locator}: skipped, missing date, amount or profit.` });
          continue;
        }
        const action = str(cell(row, h, 'action'));
        const ls = str(cell(row, h, 'longShort')).toLowerCase();
        const isShort = ls ? ls.startsWith('s') : /^sell\b/i.test(action);
        const name = action.replace(/^(buy|sell)\s+/i, '').trim() || id;
        const brokerType = str(cell(row, h, 'type')) || 'Unknown';
        const p: ClosedPosition = {
          id: `etoro:${id}`,
          broker: 'etoro',
          symbol: name,
          name,
          brokerType,
          assetClass: assetClassFromType(brokerType),
          openDate,
          closeDate,
          units: num(cell(row, h, 'units')) ?? 0,
          isShort,
          leverage: num(cell(row, h, 'leverage')) ?? 1,
          currency: 'USD',
          invested,
          profit,
          financing: num(cell(row, h, 'financing')) ?? 0,
          isin: str(cell(row, h, 'isin')) || undefined,
          source: { broker: 'etoro', file, locator },
        };
        out.closedPositions.push(p);
      }
    }
  }

  const divs = findSheet(sheets, 'Dividends');
  if (divs) {
    const h = findHeader(divs.rows, DIVS);
    if (!h) out.warnings.push({ file, message: 'Could not find the column headings in "Dividends".' });
    else {
      for (let r = h.headerRow + 1; r < divs.rows.length; r++) {
        const row = divs.rows[r]!;
        const date = isoDate(cell(row, h, 'date'), ETORO_TZ);
        const net = num(cell(row, h, 'net'));
        if (!date || net === null) continue;
        const name = str(cell(row, h, 'name')) || 'dividend';
        const isin = str(cell(row, h, 'isin'));
        const type = str(cell(row, h, 'type'));
        const posId = str(cell(row, h, 'positionId'));
        const locator = `Dividends, row ${r + 1}`;
        const src = { broker: 'etoro' as const, file, locator };
        // Dividend adjustments on CFD positions are part of the CFD result, not dividend income.
        if (/cfd/i.test(type)) {
          out.closedPositions.push({
            id: `etoro:divadj:${posId || r}:${date}`, broker: 'etoro', symbol: name, name, brokerType: 'CFD', assetClass: 'cfd',
            openDate: date, closeDate: date, units: 0, isShort: net < 0, leverage: 1, currency: 'USD', invested: 0, profit: net, financing: 0,
            source: src,
          });
          continue;
        }
        const wht = Math.abs(num(cell(row, h, 'withholding')) ?? 0);
        out.income.push({
          id: `etoro:div:${posId || name}:${date}:${r}`,
          broker: 'etoro',
          kind: 'dividend',
          date,
          symbol: name,
          name,
          country: isin.length >= 2 ? isin.slice(0, 2).toUpperCase() : 'foreign',
          currency: 'USD',
          netAmount: net,
          withholding: wht,
          source: src,
        });
      }
    }
  }
  return out;
}

function assetClassFromType(t: string): AssetClass {
  const s = t.toLowerCase();
  if (s.includes('crypto')) return 'crypto';
  if (s.includes('cfd')) return 'cfd';
  if (s.includes('etf')) return 'etf';
  if (s.includes('stock') || s.includes('share')) return 'share';
  return 'unknown';
}

function readPeriod(sheets: Sheet[]): { from: string; to: string } | undefined {
  const s = findSheet(sheets, 'Account Summary');
  if (!s) return undefined;
  let from: string | null = null;
  let to: string | null = null;
  for (const row of s.rows.slice(0, 20)) {
    const k = str(row[0]).toLowerCase();
    if (k.startsWith('start date')) from = isoDate(row[1]);
    if (k.startsWith('end date')) to = isoDate(row[1]);
  }
  return from && to ? { from, to } : undefined;
}
