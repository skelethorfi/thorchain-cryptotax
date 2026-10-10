# Contributing and support

## Adding a transaction type

Every supported transaction type has golden cases in `test/cases/`: real
source data and the CSV rows the exporter must produce. Cases are built from
public transactions with the fixture tool (`npm run fixture`), which can refuse
to write your own wallet addresses and txids into a case. The layout and the
workflow are in [specs/fixtures.md](specs/fixtures.md).

For a new type: add a case, write or extend its spec in [specs/](specs/README.md)
(which rows, types, fees and descriptions, and why), implement the mapper, then
review the rows with `npm run fixture -- show test/cases/<group/name>` before
saving them with `--write`. Run `npm run typecheck` and `npm test`.

## Reporting issues

This tool was built mainly to cover one person's own usage, so you may well run
into errors. Raise them on
[GitHub](https://github.com/skelethorfi/skeletax/issues) or DM
[@skelethorfi](https://x.com/skelethorfi) on X. A run lists what it could not
map in its output folder (`unsupported/` and `failures/`), which helps say what
is missing.

## Supporting development

If it saved you a lot of manual effort, feel free to send a small donation as
thanks:

- BTC: `bc1qe3lhk5d72gs6t7q6z5z982dfhzfya7d8t9thha`
- ETH: `0x6822b44Fe0EDa7962E59ed11bfdFa1F323F19C0a`
- THORChain: `thor1q3dsqslgz3kdxprvcra3e2xmessznlz0d7n3pf`

You can get $40 off a first Summ subscription with this
[referral link](https://cryptotaxcalculator.io/?via=glaj5hf5).

## Useful references

- [Summ: Advanced CSV Import](https://help.cryptotaxcalculator.io/en/articles/5777675-advanced-custom-csv-import)
- [THORChain Dev Docs: Asset Notation](https://dev.thorchain.org/concepts/asset-notation.html)
- [THORChain Dev Docs: Transaction Memos](https://dev.thorchain.org/concepts/memos.html)
- [Thornode API docs](https://gateway.liquify.com/chain/thorchain_api/thorchain/doc)
- [XChainJS docs](https://docs.xchainjs.org)
- [`reference/`](reference/README.md): a sample of the Summ advanced CSV and the Midgard API spec
