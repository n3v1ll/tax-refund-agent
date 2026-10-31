/**
 * Stockspot Annual Tax Statement (PDF). Stockspot already calculates figures
 * against myTax labels, so this parser reads each label and its amount from
 * the PDF text and passes them through.
 *
 * Input is the PDF's text as lines (see src/io/pdf.ts).
 */
import type { Ledger, ReportedCapitalGains } from '../model';
import { emptyLedger } from '../model';

const LABEL_RE = /(?:^|[\s(\[])((?:1[0-9]|2[0-4])[A-Z])(?=$|[\s)\],:])/g;
const AMOUNT_RE = /\(?-?\$?\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})\)?|\(?-?\$?\s?\d+\.\d{2}\)?/g;

export function isStockspotText(lines: string[]): boolean {
  const head = lines.slice(0, 80).join(' ').toLowerCase();
  return head.includes('stockspot');
}

function parseAmount(s: string): number {
  const neg = s.includes('(') || s.includes('-');
  const n = Number(s.replace(/[()$,\s-]/g, ''));
  return neg ? -n : n;
}

export function parseStockspotText(file: string, lines: string[]): Ledger {
  const out = emptyLedger();
  out.documents.push({ file, broker: 'stockspot', kind: 'Annual tax statement' });
  const found = new Map<string, { amount: number; description: string; line: number }>();
  const comps: Partial<Record<'discount' | 'other' | 'losses', number>> = {};

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) return;
    const amounts = line.match(AMOUNT_RE);
    if (!amounts) return;
    const amount = parseAmount(amounts[amounts.length - 1]!);
    const labels = [...line.matchAll(LABEL_RE)].map((m) => m[1]!);
    const text = line.replace(AMOUNT_RE, '').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    if (/discount/.test(lower) && /(gross|before)/.test(lower) && !/non.?discount/.test(lower)) comps.discount ??= amount;
    else if (/(other method|non.?discount|indexation)/.test(lower) && /gain/.test(lower)) comps.other = (comps.other ?? 0) + amount;
    else if (/capital loss/.test(lower) && !/carried forward|prior/.test(lower)) comps.losses ??= Math.abs(amount);
    if (labels.length !== 1) return;
    const label = labels[0]!;
    const prev = found.get(label);
    if (prev) {
      if (Math.abs(prev.amount - amount) > 0.005) out.warnings.push({ file, message: `Label ${label} appears twice with different amounts (${prev.amount} and ${amount}); used the first.` });
      return;
    }
    found.set(label, { amount, description: `Stockspot: ${text.replace(LABEL_RE, ' ').replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim()}`, line: i + 1 });
  });

  const src = (line: number) => ({ broker: 'stockspot' as const, file, locator: `line ${line}` });
  for (const [label, f] of found) {
    if (label.startsWith('18')) continue;
    out.reported.push({ label, amount: f.amount, description: f.description, source: src(f.line) });
  }

  const h = found.get('18H');
  const a = found.get('18A');
  let rg: ReportedCapitalGains | null = null;
  if (comps.discount !== undefined || comps.other !== undefined) {
    rg = { discountGainsGross: comps.discount ?? 0, otherGains: comps.other ?? 0, capitalLosses: comps.losses ?? 0, description: 'Stockspot realised capital gains', derived: false, source: src(h?.line ?? 0) };
  } else if (h && a) {
    const discountGross = Math.max(0, Math.round(2 * (h.amount - a.amount) * 100) / 100);
    rg = { discountGainsGross: discountGross, otherGains: Math.round((h.amount - discountGross) * 100) / 100, capitalLosses: 0, description: 'Stockspot capital gains', derived: true, source: src(h.line) };
  } else if (h) {
    out.warnings.push({ file, message: 'Found total capital gains (18H) but not net capital gain (18A) or a breakdown, so Stockspot capital gains were not included. Upload the Realised Capital Gains report.' });
  }
  if (rg) out.reportedCapitalGains.push(rg);
  if (found.size === 0) out.warnings.push({ file, message: 'No myTax labels found in this Stockspot document. Is it the Annual Tax Statement?' });
  return out;
}
