/**
 * Download RBA F11.1 daily exchange rates and write web/public/fx/rba-f11.json.
 * Runs in CI (see .github/workflows/update-fx.yml) because the RBA site is
 * not reachable from every build environment.
 *
 * Run: npm run fx:update
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { mergeFx, parseRbaF11Csv } from '../src/engine/fx';

const URLS = [
  // Current table (roughly 2023 onwards)
  'https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv',
];

const tables = [];
for (const url of URLS) {
  const res = await fetch(url, { headers: { 'user-agent': 'tax-refund-agent fx updater' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  tables.push(parseRbaF11Csv(await res.text(), 'RBA F11.1'));
}
const fx = mergeFx(...tables);
const days = Object.keys(fx.rates.USD ?? {}).sort();
if (days.length < 200) throw new Error(`Only ${days.length} USD rates parsed; refusing to write`);
fx.source = `RBA F11.1, ${days[0]} to ${days[days.length - 1]}`;
mkdirSync('web/public/fx', { recursive: true });
writeFileSync('web/public/fx/rba-f11.json', JSON.stringify(fx));
console.log(`Wrote ${days.length} days of rates (${fx.source})`);
