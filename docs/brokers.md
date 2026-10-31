# Broker documents: what each parser assumes

Each assumption below needs checking against a real, redacted statement. Column names are matched loosely (see the alias lists in each parser), so small renames are tolerated.

## eToro: account statement (XLSX)
* Sheets `Closed Positions`, `Dividends`, `Account Summary` (start and end dates).
* Closed Positions columns: Position ID, Action ("Buy Apple" / "Sell Tesla"), Long / Short, Amount (USD invested), Units / Contracts, Open Date, Close Date (dd/mm/yyyy hh:mm:ss, **assumed UTC**), Leverage, Profit(USD), Overnight Fees and Dividends, Type (Stocks / ETF / CFD / Crypto), ISIN.
* Cost base = Amount at the open-date rate; proceeds = Amount + Profit at the close-date rate. Assumes Profit(USD) is net of eToro's closing fees and excludes overnight fees.
* Dates are converted from UTC to Australia/Sydney, so a US close late on 30 June UTC counts in the next income year. **Verify the time zone.**
* Dividends: Date of Payment, Instrument Name, Net Dividend Received (USD), Withholding Tax Amount (USD), Type, ISIN. Country is taken from the ISIN prefix. Rows with Type CFD are treated as CFD adjustments (other income), not dividends.
* Not read yet: Account Activity (interest on cash, fees), Financial Summary (could be used to reconcile totals).

## CMC Invest: trade history (CSV or XLSX)
* One row per trade: trade date, buy/sell, code, name, market, quantity, price, consideration, brokerage, GST, currency, reference.
* Currency comes from the Currency column, otherwise the market (NASDAQ/NYSE → USD, ASX → AUD).
* Brokerage plus GST is added to the cost base of buys and subtracted from the proceeds of sells.
* **Unknown:** the real export's column names, whether US trades show a USD price or an AUD amount with an FX rate, and how the EOFY Trading Statement PDF lays out international dividends. The PDF is not read yet.

## Stockspot: Annual Tax Statement (PDF)
* Reads every line that has a myTax label code (e.g. `13U`, `18H`, `20O`) and an amount, and passes the figure through.
* Capital gains: uses "discounted capital gains (grossed up)" and "other method" lines if present; otherwise derives them from 18H and 18A (assumes Stockspot netted no losses, and warns).
* **Unknown:** exact wording and layout; whether the statement shows labels next to amounts on the same line (the parser groups text by line).
