/**
 * Turn an uploaded file into a Ledger: detect the broker and document type,
 * then hand it to the matching parser. Works in the browser and in Node.
 */
import readXlsxFile from 'read-excel-file/universal';
import type { Ledger } from '../model';
import { emptyLedger } from '../model';
import { csvToSheet, type Sheet } from './table';
import { isEtoroStatement, parseEtoro } from '../parsers/etoro';
import { looksLikeIncomeTemplate, looksLikeTradeList, parseIncomeTemplate, parseTradeList } from '../parsers/trades';
import { isStockspotText, parseStockspotText } from '../parsers/stockspot';
import { pdfToLines } from './pdf';

export type BrokerHint = 'auto' | 'etoro' | 'cmc-invest' | 'stockspot' | 'generic';

export interface LoadResult {
  ledger: Ledger;
  detected: string;
}

export async function loadFile(name: string, bytes: Uint8Array, hint: BrokerHint = 'auto'): Promise<LoadResult> {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const sheets = (await readXlsxFile(ab)).map((s) => ({ name: s.sheet, rows: s.data as Sheet['rows'] }));
    return parseSheets(name, sheets, hint);
  }
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = new TextDecoder('utf-8').decode(bytes);
    return parseSheets(name, [csvToSheet(name, text)], hint);
  }
  if (lower.endsWith('.pdf')) {
    const lines = await pdfToLines(bytes);
    return parsePdfText(name, lines, hint);
  }
  const l = emptyLedger();
  l.warnings.push({ file: name, message: 'Unsupported file type. Upload the Excel (.xlsx), CSV or PDF version.' });
  return { ledger: l, detected: 'unsupported' };
}

export function parseSheets(name: string, sheets: Sheet[], hint: BrokerHint = 'auto'): LoadResult {
  if (hint === 'etoro' || (hint === 'auto' && isEtoroStatement(sheets))) return { ledger: parseEtoro(name, sheets), detected: 'eToro account statement' };
  for (const s of sheets) {
    if (looksLikeIncomeTemplate(s)) return { ledger: parseIncomeTemplate(name, s), detected: 'Income list (template)' };
    if (looksLikeTradeList(s)) {
      const broker = hint === 'generic' ? 'generic' : hint === 'cmc-invest' || /cmc/i.test(name) ? 'cmc-invest' : 'generic';
      return { ledger: parseTradeList(name, s, broker), detected: broker === 'cmc-invest' ? 'CMC Invest trade list' : 'Trade list' };
    }
  }
  const l = emptyLedger();
  l.warnings.push({ file: name, message: 'We could not recognise this spreadsheet. Check it is the eToro account statement, a CMC Invest trade list, or our CSV template.' });
  return { ledger: l, detected: 'unrecognised' };
}

export function parsePdfText(name: string, lines: string[], hint: BrokerHint = 'auto'): LoadResult {
  if (hint === 'stockspot' || (hint === 'auto' && isStockspotText(lines))) return { ledger: parseStockspotText(name, lines), detected: 'Stockspot annual tax statement' };
  const l = emptyLedger();
  l.warnings.push({ file: name, message: 'We cannot read this PDF automatically yet. If your broker offers a CSV or Excel download, upload that instead.' });
  return { ledger: l, detected: 'unrecognised PDF' };
}
