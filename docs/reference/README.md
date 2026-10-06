# Reference files

Copies of external formats the exporter reads or writes. Nothing in the code
loads them.

- [`advanced.csv`](advanced.csv): Summ's (formerly Crypto Tax Calculator)
  sample for its advanced custom CSV import, the format every output CSV
  follows. The row type is `src/export/summ/csv/CryptoTaxTranaction.ts`; the
  format is described in
  [Advanced Custom CSV Import](https://help.cryptotaxcalculator.io/en/articles/5777675-advanced-custom-csv-import).
- [`midgard-api-2.32.9.json`](midgard-api-2.32.9.json): the OpenAPI spec of
  Midgard 2.32.9, the source of the actions the interpreters read
  (`src/sources/thorchain/MidgardService.ts`).
