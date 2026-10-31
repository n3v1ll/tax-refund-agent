/**
 * Generates the synthetic sample statements in test/fixtures (also served as
 * demo files by the web app). The layouts imitate the real documents as far
 * as we know them; real redacted statements will replace these.
 *
 * Run: npx tsx scripts/make-fixtures.ts
 */
import writeExcelFile from 'write-excel-file/node';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';

const DIR = 'test/fixtures';
mkdirSync(DIR, { recursive: true });

async function etoro() {
  const summary = [
    ['Account Summary', ''],
    ['Start Date', '01/07/2025'],
    ['End Date', '30/06/2026'],
    ['Beginning Realized Equity', 10000],
  ];
  const closedHeader = ['Position ID', 'Action', 'Long / Short', 'Amount', 'Units / Contracts', 'Open Date', 'Close Date', 'Leverage', 'Spread Fees (USD)', 'Market Spread (USD)', 'Profit(USD)', 'FX rate at open (USD)', 'FX rate at close (USD)', 'Open Rate', 'Close Rate', 'Take profit rate', 'Stop lose rate', 'Overnight Fees and Dividends', 'Copied From', 'Type', 'ISIN', 'Notes'];
  const closed = [
    // Real share, held > 12 months: discount gain
    ['2101', 'Buy Apple', 'Long', 1500, 10, '15/03/2024 14:31:02', '20/08/2025 15:02:11', 1, 0, 0, 700, 1, 1, 150, 220, '', '', 0, '', 'Stocks', 'US0378331005', ''],
    // Real share, held < 12 months: loss
    ['2102', 'Buy Tesla', 'Long', 2000, 8, '02/09/2025 13:45:00', '14/01/2026 16:10:30', 1, 0, 0, -400, 1, 1, 250, 200, '', '', 0, '', 'Stocks', 'US88160R1014', ''],
    // ETF, short hold, gain
    ['2103', 'Buy SPDR S&P 500 ETF', 'Long', 3000, 6, '10/10/2025 14:00:00', '05/03/2026 15:30:00', 1, 0, 0, 300, 1, 1, 500, 550, '', '', 0, '', 'ETF', 'US78462F1030', ''],
    // Leveraged stock position: eToro reports as CFD
    ['2104', 'Buy NVIDIA', 'Long', 500, 20, '01/11/2025 15:00:00', '01/12/2025 15:00:00', 5, 0, 0, 250, 1, 1, 125, 137.5, '', '', -12.5, '', 'CFD', 'US67066G1040', ''],
    // Short = CFD
    ['2105', 'Sell Netflix', 'Short', 400, 1, '05/02/2026 15:00:00', '20/02/2026 15:00:00', 1, 0, 0, 60, 1, 1, 1000, 850, '', '', -3, '', 'CFD', 'US64110L1061', ''],
    // Crypto: out of scope
    ['2106', 'Buy Bitcoin', 'Long', 1000, 0.01, '01/08/2025 10:00:00', '01/10/2025 10:00:00', 1, 0, 0, 150, 1, 1, 100000, 115000, '', '', 0, '', 'Crypto', '', ''],
    // Closed 30 June 23:30 UTC = 1 July in Sydney, so next income year
    ['2107', 'Buy Microsoft', 'Long', 800, 2, '01/05/2026 14:00:00', '30/06/2026 23:30:00', 1, 0, 0, 40, 1, 1, 400, 420, '', '', 0, '', 'Stocks', 'US5949181045', ''],
  ];
  const divHeader = ['Date of Payment', 'Instrument Name', 'Net Dividend Received (USD)', 'Net Dividend Received (Units)', 'Withholding Tax Rate (%)', 'Withholding Tax Amount (USD)', 'Withholding Tax Amount (Units)', 'Position ID', 'Type', 'ISIN'];
  const divs = [
    ['14/08/2025', 'Apple', 2.13, 0, '15 %', 0.38, 0, '2101', 'Stocks', 'US0378331005'],
    ['15/11/2025', 'Microsoft', 4.25, 0, '15 %', 0.75, 0, '2099', 'Stocks', 'US5949181045'],
    ['31/01/2026', 'SPDR S&P 500 ETF', 8.5, 0, '15 %', 1.5, 0, '2103', 'ETF', 'US78462F1030'],
    ['20/11/2025', 'NVIDIA', 0.17, 0, '0 %', 0, 0, '2104', 'CFD', 'US67066G1040'],
  ];
  const activity = [
    ['Date', 'Type', 'Details', 'Amount', 'Units', 'Realized Equity Change', 'Realized Equity', 'Balance', 'Position ID', 'Asset type', 'NWA'],
    ['01/07/2025 09:00:00', 'Deposit', '', 5000, '', 5000, 15000, 15000, '', '', ''],
  ];
  await writeExcelFile([
    { sheet: 'Account Summary', data: summary },
    { sheet: 'Closed Positions', data: [closedHeader, ...closed] },
    { sheet: 'Account Activity', data: activity },
    { sheet: 'Dividends', data: [divHeader, ...divs] },
  ] as never).toFile(`${DIR}/etoro-account-statement-sample.xlsx`);
}

function cmc() {
  const rows = [
    'Trade Date,Settlement Date,Buy/Sell,Code,Security Name,Market,Quantity,Price,Consideration,Brokerage,GST,Currency,Reference',
    // Bought before the statement period: present so the sale matches
    '12/02/2024,14/02/2024,Buy,VAS,Vanguard Australian Shares ETF,ASX,50,92.10,4605.00,10.00,0,AUD,C1001',
    '03/09/2025,05/09/2025,Buy,VAS,Vanguard Australian Shares ETF,ASX,20,101.50,2030.00,5.00,0,AUD,C1002',
    '18/03/2026,20/03/2026,Sell,VAS,Vanguard Australian Shares ETF,ASX,60,108.00,6480.00,10.00,0,AUD,C1003',
    '22/07/2025,24/07/2025,Buy,BHP,BHP Group Ltd,ASX,100,41.20,4120.00,5.00,0,AUD,C1004',
    '10/02/2026,12/02/2026,Sell,BHP,BHP Group Ltd,ASX,100,44.80,4480.00,5.00,0,AUD,C1005',
    // US share sold with no buy in this file: should trigger a missing document request
    '04/11/2025,06/11/2025,Sell,AAPL,Apple Inc,NASDAQ,5,270.00,1350.00,0,0,USD,C1006',
  ];
  writeFileSync(`${DIR}/cmc-invest-trades-sample.csv`, rows.join('\n') + '\n');
}

async function stockspot() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const lines = [
    'Stockspot Pty Ltd',
    'Annual Tax Statement 1 July 2025 to 30 June 2026',
    'Investor: Sample Investor',
    'Tax return (supplementary section)        Label        Amount',
    'Share of net income from trusts             13U          $412.36',
    'Franked distributions from trusts           13C          $198.20',
    'Share of franking credits                   13Q           $61.14',
    'Total current year capital gains            18H        $1,240.00',
    'Net capital gain                            18A          $720.00',
    'Assessable foreign source income            20E           $95.40',
    'Other net foreign source income             20M           $95.40',
    'Foreign income tax offset                   20O           $12.85',
    'Capital gains breakdown',
    'Discounted capital gains (grossed up)                   $1,040.00',
    'Capital gains - other method                              $200.00',
  ];
  lines.forEach((t, i) => page.drawText(t, { x: 40, y: 800 - i * 18, size: 10, font }));
  writeFileSync(`${DIR}/stockspot-annual-tax-statement-sample.pdf`, await doc.save());
}

await etoro();
cmc();
await stockspot();
mkdirSync('web/public/samples', { recursive: true });
for (const f of ['etoro-account-statement-sample.xlsx', 'cmc-invest-trades-sample.csv', 'stockspot-annual-tax-statement-sample.pdf']) copyFileSync(`${DIR}/${f}`, `web/public/samples/${f}`);
console.log('fixtures written');
