/**
 * Tabular trade lists: CMC Invest trade history / EOFY trading statement
 * exported to CSV or Excel, and our own generic CSV template.
 */
import type { AssetClass, Broker, Ledger, Trade, IncomeEvent } from '../model';
import { emptyLedger } from '../model';
import { cell, findHeader, isoDate, norm, num, str, type ColumnSpec, type Sheet } from '../io/table';

const TRADE_COLS: ColumnSpec<'date' | 'side' | 'symbol' | 'name' | 'units' | 'price' | 'fees' | 'gst' | 'value' | 'currency' | 'market' | 'assetClass' | 'reference'> = {
  date: { aliases: ['trade date', 'date', 'transaction date', 'order date', 'execution date', 'traded'], required: true },
  side: { aliases: ['side', 'buy/sell', 'buy sell', 'b/s', 'transaction type', 'order type', 'trade type', 'type', 'action', 'direction'], required: true },
  symbol: { aliases: ['symbol', 'code', 'security code', 'ticker', 'asx code', 'stock code', 'instrument code', 'security'], required: true },
  name: { aliases: ['name', 'security name', 'company', 'company name', 'instrument', 'description', 'stock name'] },
  units: { aliases: ['units', 'quantity', 'qty', 'volume', 'shares', 'filled quantity'], required: true },
  price: { aliases: ['price', 'trade price', 'unit price', 'average price', 'avg price', 'executed price', 'price per unit'] },
  fees: { aliases: ['fees', 'brokerage', 'commission', 'brokerage inc gst', 'brokerage incl gst', 'fee'] },
  gst: { aliases: ['gst'] },
  value: { aliases: ['value', 'consideration', 'gross value', 'trade value', 'total value'] },
  currency: { aliases: ['currency', 'ccy', 'trade currency', 'settlement currency'] },
  market: { aliases: ['market', 'exchange'] },
  assetClass: { aliases: ['asset class', 'asset_class'] },
  reference: { aliases: ['reference', 'order id', 'trade id', 'confirmation number', 'contract note', 'ref'] },
};

const INCOME_COLS: ColumnSpec<'date' | 'kind' | 'symbol' | 'country' | 'currency' | 'net' | 'withholding' | 'franked' | 'unfranked' | 'credit'> = {
  date: { aliases: ['date', 'payment date', 'pay date'], required: true },
  kind: { aliases: ['kind'], required: true },
  symbol: { aliases: ['symbol', 'code'] },
  country: { aliases: ['country'], required: true },
  currency: { aliases: ['currency'] },
  net: { aliases: ['net', 'net amount'], required: true },
  withholding: { aliases: ['withholding', 'tax withheld'] },
  franked: { aliases: ['franked'] },
  unfranked: { aliases: ['unfranked'] },
  credit: { aliases: ['franking credit', 'franking_credit'] },
};

export function looksLikeTradeList(s: Sheet): boolean {
  return findHeader(s.rows, TRADE_COLS) !== null;
}

export function looksLikeIncomeTemplate(s: Sheet): boolean {
  return findHeader(s.rows, INCOME_COLS) !== null;
}

function parseSide(v: string): 'buy' | 'sell' | null {
  const s = norm(v);
  if (/^(b|buy|bought|purchase|buy order|market buy|limit buy)\b/.test(s)) return 'buy';
  if (/^(s|sell|sold|sale|sell order|market sell|limit sell)\b/.test(s)) return 'sell';
  return null;
}

function inferCurrency(market: string, symbol: string): string {
  const m = norm(market);
  if (/(nyse|nasdaq|us|amex|bats|arca)/.test(m)) return 'USD';
  if (/(asx|cboe au|chi x|au)/.test(m)) return 'AUD';
  if (/\.(ax|asx)$/i.test(symbol)) return 'AUD';
  return 'AUD';
}

export function parseTradeList(file: string, sheet: Sheet, broker: Broker): Ledger {
  const out = emptyLedger();
  const h = findHeader(sheet.rows, TRADE_COLS);
  if (!h) {
    out.warnings.push({ file, message: 'Could not find trade columns (date, buy/sell, code, quantity).' });
    return out;
  }
  out.documents.push({ file, broker, kind: 'Trade list' });
  let skipped = 0;
  for (let r = h.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]!;
    const locator = `${sheet.name}, row ${r + 1}`;
    const side = parseSide(str(cell(row, h, 'side')));
    const date = isoDate(cell(row, h, 'date'));
    const symbol = str(cell(row, h, 'symbol')).toUpperCase().replace(/\.(AX|ASX)$/, '');
    const units = Math.abs(num(cell(row, h, 'units')) ?? NaN);
    if (!side || !date || !symbol || !Number.isFinite(units) || units === 0) {
      if (row.some((c) => str(c) !== '')) skipped++;
      continue;
    }
    let price = num(cell(row, h, 'price'));
    const value = num(cell(row, h, 'value'));
    if (price === null && value !== null) price = Math.abs(value) / units;
    if (price === null) { out.warnings.push({ file, message: `${locator}: no price or value, skipped.` }); continue; }
    const fees = Math.abs(num(cell(row, h, 'fees')) ?? 0) + Math.abs(num(cell(row, h, 'gst')) ?? 0);
    const currency = (str(cell(row, h, 'currency')) || inferCurrency(str(cell(row, h, 'market')), symbol)).toUpperCase();
    const ac = norm(str(cell(row, h, 'assetClass')));
    const assetClass: AssetClass = (['share', 'etf', 'cfd', 'crypto'] as const).find((a) => ac === a) ?? 'share';
    const ref = str(cell(row, h, 'reference'));
    const t: Trade = {
      id: `${broker}:${ref || `${symbol}:${side}:${date}:${units}:${price}:${r}`}`,
      broker,
      date,
      side,
      symbol,
      name: str(cell(row, h, 'name')) || undefined,
      units,
      price: Math.abs(price),
      currency,
      fees,
      assetClass,
      source: { broker, file, locator },
    };
    out.trades.push(t);
  }
  if (skipped) out.warnings.push({ file, message: `${skipped} row(s) were not trades and were skipped.` });
  return out;
}

export function parseIncomeTemplate(file: string, sheet: Sheet): Ledger {
  const out = emptyLedger();
  const h = findHeader(sheet.rows, INCOME_COLS)!;
  out.documents.push({ file, broker: 'generic', kind: 'Income list' });
  for (let r = h.headerRow + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]!;
    const date = isoDate(cell(row, h, 'date'));
    const net = num(cell(row, h, 'net'));
    if (!date || net === null) continue;
    const kind = norm(str(cell(row, h, 'kind'))) === 'interest' ? 'interest' : 'dividend';
    const e: IncomeEvent = {
      id: `generic:income:${r}:${date}`,
      broker: 'generic',
      kind,
      date,
      symbol: str(cell(row, h, 'symbol')) || undefined,
      country: (str(cell(row, h, 'country')) || 'AU').toUpperCase(),
      currency: (str(cell(row, h, 'currency')) || 'AUD').toUpperCase(),
      netAmount: net,
      withholding: Math.abs(num(cell(row, h, 'withholding')) ?? 0),
      frankedAmount: num(cell(row, h, 'franked')) ?? undefined,
      unfrankedAmount: num(cell(row, h, 'unfranked')) ?? undefined,
      frankingCredit: num(cell(row, h, 'credit')) ?? undefined,
      source: { broker: 'generic', file, locator: `${sheet.name}, row ${r + 1}` },
    };
    out.income.push(e);
  }
  return out;
}

export const GENERIC_TRADE_TEMPLATE = 'date,side,symbol,name,units,price,fees,currency,asset_class,reference\n2025-08-01,buy,VAS,Vanguard Australian Shares ETF,10,100.00,5.00,AUD,etf,\n';
export const GENERIC_INCOME_TEMPLATE = 'date,kind,symbol,country,currency,net,withholding,franked,unfranked,franking_credit\n2025-09-30,dividend,CBA,AU,AUD,100.00,0,100.00,0,42.86\n';
