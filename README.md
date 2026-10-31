# Tax Refund Agent

Turns Australian broker tax statements into the figures myTax asks for. You check each figure and type it into myTax yourself.

It is a calculator, not tax advice: every tax rule is written in code and applied the same way for everyone, the user confirms each figure, and nothing is ever lodged. See [docs/legal-design.md](docs/legal-design.md).

## What it covers (MVP)

| | |
|---|---|
| Brokers | eToro (account statement XLSX), CMC Invest (trade history CSV/XLSX), Stockspot (Annual Tax Statement PDF), any other broker through a CSV template |
| Assets | ASX and US shares, ETFs, CFDs |
| myTax labels | 10L, 11S/T/U, 13U/C/Q, 18G/H/A/V, 20E/M/O, 24Y |
| Rules | 12-month 50% discount, losses applied to non-discount gains first, carried-forward losses, FIFO or lowest-tax parcel matching, RBA daily FX per leg, CFDs as other income, foreign dividends grossed up, FITO up to $1,000 |
| Out of scope (flagged, not calculated) | crypto, property, trader status, non-residents, FX gains on cash balances, net CFD losses, FITO above $1,000 |

## How it works

```
files ──> src/io/load.ts ──> parsers (src/parsers) ──> Ledger (src/model.ts)
                                                          │
           rules + label map (src/rules) ──> engine (src/engine/compute.ts)
                                                          │
                         figures + "why" lines + issues (what's missing)
                                                          │
                     web app: confirm each figure, copy, print workpaper
```

* **Parsers only record what a document says.** They never decide tax treatment.
* **The engine** turns the ledger into figures. Every figure carries the lines behind it (each trade, with file and row) and the rule ids used.
* **Issues** are how the app asks for missing documents: a sale with no matching purchase, an AU dividend without franking details, missing FX rates. Blockers stop the related figures from being confirmed.
* **The web app runs entirely in the browser.** Statements are never uploaded to a server.

## Run it

```bash
npm install
npm run dev        # web app at http://localhost:5173 ("Try made-up sample statements")
npm test           # engine + parser tests
npm run cli -- --year 2026 --fx f11.1-data.csv statement.xlsx trades.csv tax-statement.pdf
```

Exchange rates: the app reads `web/public/fx/rba-f11.json`, refreshed weekly by `.github/workflows/update-fx.yml` (or `npm run fx:update`). You can also drop the RBA [F11.1 CSV](https://www.rba.gov.au/statistics/tables/csv/f11.1-data.csv) in with your statements.

## Status

Parsers are written against the documents' published layouts and synthetic samples in `test/fixtures` (regenerate with `npx tsx scripts/make-fixtures.ts`). They need checking against real, redacted statements; see [docs/brokers.md](docs/brokers.md) for each assumption. See [docs/roadmap.md](docs/roadmap.md) for what's next.
