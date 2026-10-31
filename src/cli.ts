/**
 * Command-line runner, for checking real statements locally.
 *
 *   npm run cli -- --year 2026 --fx f11.1-data.csv --prior-losses 0 statement.xlsx trades.csv tax.pdf
 *
 * Prints each myTax figure with the lines behind it, then anything still needed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { loadFile } from './io/load';
import { mergeLedgers } from './model';
import { computeReturn, type ParcelMethod } from './engine/compute';
import { mergeFx, parseRbaF11Csv, type FxTable } from './engine/fx';
import { labelDef } from './rules/labels';

const args = process.argv.slice(2);
let year = 2026;
let prior = 0;
let method: ParcelMethod = 'fifo';
const fxTables: FxTable[] = [];
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === '--year') year = Number(args[++i]);
  else if (a === '--prior-losses') prior = Number(args[++i]);
  else if (a === '--lowest-tax') method = 'lowest_tax';
  else if (a === '--fx') fxTables.push(parseRbaF11Csv(readFileSync(args[++i]!, 'utf8')));
  else files.push(a);
}
if (!fxTables.length && existsSync('web/public/fx/rba-f11.json')) fxTables.push(JSON.parse(readFileSync('web/public/fx/rba-f11.json', 'utf8')));
if (!files.length) {
  console.error('Usage: npm run cli -- [--year 2026] [--fx f11.1-data.csv] [--prior-losses N] [--lowest-tax] files...');
  process.exit(1);
}

const ledgers = [];
for (const f of files) {
  const r = await loadFile(basename(f), new Uint8Array(readFileSync(f)));
  console.log(`Read ${f} as: ${r.detected}`);
  ledgers.push(r.ledger);
}
const fx = fxTables.length ? mergeFx(...fxTables) : { rates: {}, source: 'none' };
const res = computeReturn(mergeLedgers(...ledgers), year, fx, { priorYearLosses: prior, parcelMethod: method });

console.log(`\nmyTax figures for ${year - 1}-${String(year).slice(2)} (exchange rates: ${fx.source})\n`);
for (const f of res.figures) {
  if (f.code !== '18G' && f.value === 0 && f.lines.length === 0) continue;
  const def = labelDef(f.code)!;
  const v = typeof f.value === 'boolean' ? (f.value ? 'Yes' : 'No') : def.format === 'dollars' ? `$${Math.trunc(f.value)}` : `$${f.value.toFixed(2)}`;
  console.log(`${f.code.padEnd(4)} ${def.title.padEnd(60)} ${v}${f.blockedBy.length ? '  (BLOCKED)' : ''}`);
  for (const l of f.lines) console.log(`       ${l.amount.toFixed(2).padStart(12)}  ${l.description}`);
}
if (res.issues.length) {
  console.log('\nStill needed / worth checking:');
  for (const i of res.issues) console.log(`  [${i.severity}] ${i.message}${i.ask ? ' -> ' + i.ask : ''}`);
}
