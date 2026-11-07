# Roadmap

Done in the first pass:
- Rules engine with tests (CGT, losses, discount, FX, CFDs, dividends, FITO cap)
- eToro, CMC Invest, Stockspot and generic CSV parsers with synthetic samples
- Browser app: intake, documents checklist, upload, missing-document requests, manual purchase entry, classification review, myTax-ordered figures with confirm-then-copy, printable workpaper
- CLI for local checks; CI; weekly RBA rate refresh

Next:
1. Check parsers against real redacted statements (eToro, CMC Invest, Stockspot) and turn them into fixtures.
2. Load older RBA rates (pre-2023 historical file is XLS) for purchases made before 2023.
3. AI document reader (Claude, structured output into the `Ledger` schema only) for PDFs without a parser, e.g. the CMC Invest EOFY statement and ETF AMMA statements. Needs a small server for the API key, or a bring-your-own-key option.
4. eToro Account Activity: interest on cash balances, and reconcile against Financial Summary.
5. AMMA statements for ETFs held directly (item 13 and capital gain components).
6. Verify every rule citation and myTax label wording for 2025-26; set `verified: true`.
7. Hosting (static site) and a paid tier with registered agent review.
