/**
 * Extract text lines from a PDF with pdf.js. Text items are grouped into lines
 * by their vertical position, then sorted left to right.
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

export async function pdfToLines(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string }[]>();
    for (const it of content.items as TextItem[]) {
      if (!('str' in it) || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]! / 2) * 2;
      (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4]!, s: it.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      lines.push(rows.get(y)!.sort((a, b) => a.x - b.x).map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim());
    }
  }
  return lines;
}
