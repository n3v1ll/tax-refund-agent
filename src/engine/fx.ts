/**
 * RBA daily exchange rates. RBA quotes "A$1 = X units of foreign currency",
 * so AUD = foreign amount / rate.
 */
export interface FxTable {
  /** currency -> (ISO date -> foreign units per A$1) */
  rates: Record<string, Record<string, number>>;
  source: string;
}

export class FxError extends Error {
  constructor(public currency: string, public date: string, message: string) {
    super(message);
  }
}

/** Maximum days to look back for a rate (long weekends, Christmas). */
const MAX_LOOKBACK = 10;

export function rateFor(fx: FxTable, currency: string, date: string): { rate: number; rateDate: string } {
  if (currency === 'AUD') return { rate: 1, rateDate: date };
  const table = fx.rates[currency];
  if (!table) throw new FxError(currency, date, `No ${currency} exchange rates loaded`);
  let t = Date.parse(date + 'T00:00:00Z');
  for (let i = 0; i <= MAX_LOOKBACK; i++) {
    const d = new Date(t).toISOString().slice(0, 10);
    const r = table[d];
    if (r) return { rate: r, rateDate: d };
    t -= 86400000;
  }
  throw new FxError(currency, date, `No ${currency} rate on or within ${MAX_LOOKBACK} days before ${date}`);
}

export function toAud(fx: FxTable, amount: number, currency: string, date: string): { aud: number; rate: number; rateDate: string } {
  const { rate, rateDate } = rateFor(fx, currency, date);
  return { aud: amount / rate, rate, rateDate };
}

const MONTHS: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

/** Map RBA F11.1 series ids to currency codes. */
const RBA_SERIES: Record<string, string> = {
  FXRUSD: 'USD', FXRCR: 'CNY', FXRJY: 'JPY', FXREUR: 'EUR', FXRSKW: 'KRW', FXRSD: 'SGD',
  FXRNZD: 'NZD', FXRUKPS: 'GBP', FXRHKD: 'HKD', FXRCD: 'CAD', FXRSF: 'CHF', FXRIRE: 'INR',
};

/**
 * Parse the RBA F11.1 CSV ("f11.1-data.csv", or the historical sheets saved as
 * CSV). Rows before "Series ID" are headers; data rows start with dd-Mmm-yyyy.
 */
export function parseRbaF11Csv(text: string, source = 'RBA F11.1'): FxTable {
  const lines = text.split(/\r?\n/).map((l) => splitCsvLine(l));
  const headerIdx = lines.findIndex((c) => (c[0] ?? '').trim() === 'Series ID');
  if (headerIdx < 0) throw new Error('Not an RBA F11.1 file: no "Series ID" row');
  const header = lines[headerIdx]!;
  const cols: { idx: number; ccy: string }[] = [];
  header.forEach((h, idx) => {
    const ccy = RBA_SERIES[h.trim()];
    if (ccy) cols.push({ idx, ccy });
  });
  const rates: FxTable['rates'] = {};
  for (const { ccy } of cols) rates[ccy] = {};
  for (const row of lines.slice(headerIdx + 1)) {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec((row[0] ?? '').trim());
    if (!m) continue;
    const iso = `${m[3]}-${MONTHS[m[2]!]}-${m[1]!.padStart(2, '0')}`;
    for (const { idx, ccy } of cols) {
      const v = parseFloat(row[idx] ?? '');
      if (Number.isFinite(v) && v > 0) rates[ccy]![iso] = v;
    }
  }
  return { rates, source };
}

export function mergeFx(...tables: FxTable[]): FxTable {
  const rates: FxTable['rates'] = {};
  for (const t of tables) for (const [c, m] of Object.entries(t.rates)) rates[c] = { ...(rates[c] ?? {}), ...m };
  return { rates, source: tables.map((t) => t.source).join(' + ') };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
