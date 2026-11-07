/**
 * Spreadsheet-like input shared by every tabular parser. Loaders turn XLSX and
 * CSV files into Sheets; parsers only ever see Sheets, so they are pure and
 * easy to test.
 */
export type Cell = string | number | boolean | Date | null | undefined;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

export function norm(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}

export type ColumnSpec<K extends string> = Record<K, { aliases: string[]; required?: boolean }>;

export interface HeaderMatch<K extends string> {
  headerRow: number;
  cols: Partial<Record<K, number>>;
}

/**
 * Find the header row (first row matching every required column) within the
 * first 30 rows, and map each logical column to its index. Exact alias matches
 * win over prefix matches.
 */
export function findHeader<K extends string>(rows: Cell[][], spec: ColumnSpec<K>): HeaderMatch<K> | null {
  const keys = Object.keys(spec) as K[];
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = (rows[r] ?? []).map(norm);
    const cols: Partial<Record<K, number>> = {};
    const used = new Set<number>();
    for (const pass of ['exact', 'prefix'] as const) {
      for (const k of keys) {
        if (cols[k] !== undefined) continue;
        for (const a of spec[k].aliases.map(norm)) {
          const idx = cells.findIndex((c, i) => !used.has(i) && (pass === 'exact' ? c === a : c.startsWith(a)));
          if (idx >= 0) { cols[k] = idx; used.add(idx); break; }
        }
      }
    }
    if (keys.every((k) => !spec[k].required || cols[k] !== undefined)) return { headerRow: r, cols };
  }
  return null;
}

export function cell<K extends string>(row: Cell[], m: HeaderMatch<K>, k: K): Cell {
  const i = m.cols[k];
  return i === undefined ? undefined : row[i];
}

/** Parse "$1,234.56", "(12.30)", "-12.3", "1 234,5"? (no: AU format only), "" -> null. */
export function num(v: Cell): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean' || v instanceof Date) return null;
  let s = v.trim();
  if (s === '-' || s === '--') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[A-Z]{3}\s*/g, '').replace(/[$A\s,]/g, '');
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  const n = Number(s);
  if (!Number.isFinite(n) || s === '') return null;
  return neg ? -n : n;
}

/**
 * Parse a date cell into an ISO date. Accepts Date objects, Excel serials,
 * yyyy-mm-dd, and day-first dd/mm/yyyy (Australian and eToro statements are
 * day-first). If `tz` is given, Date objects and timestamps with a time are
 * converted to that time zone's calendar date.
 */
export function isoDate(v: Cell, tz?: string): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return dateInTz(v, tz);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return dateInTz(new Date(Math.round((v - 25569) * 86400000)), tz);
    return null;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    if (m[4] && tz) return dateInTz(new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0))), tz);
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    const y = m[3]!.length === 2 ? 2000 + +m[3]! : +m[3]!;
    if (m[4] && tz) return dateInTz(new Date(Date.UTC(y, +m[2]! - 1, +m[1]!, +m[4]!, +m[5]!, +(m[6] ?? 0))), tz);
    return `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{4})/.exec(s);
  if (m && MON[m[2]!.toLowerCase()]) return `${m[3]}-${String(MON[m[2]!.toLowerCase()]).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

function dateInTz(d: Date, tz?: string): string {
  if (!tz) return d.toISOString().slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return parts; // en-CA formats as yyyy-mm-dd
}

export function str(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

export function findSheet(sheets: Sheet[], ...names: string[]): Sheet | undefined {
  const wanted = names.map(norm);
  return sheets.find((s) => wanted.includes(norm(s.name))) ?? sheets.find((s) => wanted.some((w) => norm(s.name).includes(w)));
}

export function csvToSheet(name: string, text: string): Sheet {
  const rows: Cell[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cur); rows.push(row); row = []; cur = '';
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return { name, rows: rows.filter((r) => r.some((c) => c !== '')) };
}
