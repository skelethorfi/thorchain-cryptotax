# Run using NodeJS

## Prerequisites

- Git
- Node

## Steps

### 1. Clone the repo

`git clone git@github.com:skelethorfi/thorchain-cryptotax.git`

### 2. Install the node packages

`npm install`

### 3. Configure your wallets

Edit [wallets-config.toml](../wallets-config.toml)

Add your wallet addresses, they can be given names using the `name` property.
Which is helpful to identify the wallets when looking at the generated CSV filenames.

Set `fromDate`, `toDate`, and `frequency` ("monthly", "yearly", "none") for how to split up the CSV files.

The `blockchain` property for each wallet is only used in creating the CSV filenames, so it can be anything.
e.g. "THOR", "BTC", "ETH"

### 4. Run the export

`npm run export`

This will get all the transactions for the wallets and create CSV files in the following path:

- `./output/{current_datetime}/csv`

Refer to the [README](../README.md) for importing into Crypto Tax Calculator

### Keeping your wallets out of the repo (optional)

Instead of editing `wallets-config.toml`, you can keep your config in a folder outside
the repo and pass its path:

`npx ts-node src/full-export.ts ../my-tax/wallets-config.toml`

Relative `outputPath`, `storePath` and `unsupportedActionsPath` values in a config
are relative to the config file's folder, so the output and cache are written next to
your config, not into the repo.

### Re-running from the cache

Downloaded data is kept in the store (`store/` next to your config, or the config's
`storePath`), one file per action or tx, and a
record that comes back different later is kept as a new copy next to the old one
(`docs/specs/snapshots.md`). Each run picks the right copy of each record, e.g. a
finalised one over a pending one, and the earlier full copy over one THORNode has
since pruned. It lists what it used in `snapshots.json` in its output folder.

- Default: download only what isn't stored yet.
- `--offline`: no network requests. Anything not stored is an error.
- `--fetch-latest`: download each wallet's history again (new activity, changed
  actions) and anything still pending. Changed records are kept as new copies, and
  the run lists what changed.
- `--refetch-all`: download every action and tx again, e.g. before filing a year,
  to see what the sources have revised or pruned since.
- `--replay <run folder>`: use exactly the records that an earlier run used, e.g.
  the run you filed.

`npx ts-node src/full-export.ts --replay ../my-tax/FY2026/2026-10-03_15-33-50 ../my-tax/wallets-config.toml`

A cache from before the store (`cache/` with one file per wallet or tx) is read on
first use. To bring several old caches into one store, oldest first:

`npm run store -- import ../my-tax/store ../my-tax/FY2025/cache ../my-tax/cache`
