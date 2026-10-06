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
Set `timezone` (e.g. "Europe/London") so the periods follow your tax year in local time; the default is UTC ([periods](specs/periods.md)).

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

Relative `outputPath` and `storePath` values in a config
are relative to the config file's folder, so the output and cache are written next to
your config, not into the repo.

Each run writes a folder under `outputPath` named by its start time, holding `csv/`,
`snapshots.json` and, when there are any, `unsupported/` and `failures/`. Actions the
exporter can't map yet are saved in `unsupported/`, one file per action, named like its
store record: `<type>/<type>.<txid>[.<contract type>].json` (another protocol's under its
own folder, e.g. `maya/`). So the folder lists exactly what that run could not map.
`unsupportedActionsPath` is no longer used; a config that sets it gets a warning.

### Re-running from the cache

Downloaded data is kept in the store (`store/` next to your config, or the config's
`storePath`), one file per action or tx, and a
record that comes back different later is kept as a new copy next to the old one
(`docs/specs/snapshots.md`). Each run picks the right copy of each record, e.g. a
finalised one over a pending one, and the earlier full copy over one THORNode has
since pruned. It lists what it used in `snapshots.json` in its output folder.

- Default: download each wallet's history again (new activity, changed actions),
  anything still pending, and anything not stored yet. Changed records are kept as
  new copies, and the run lists what changed.
- `--offline`: no network requests. Anything not stored is an error.
- `--refetch-all`: download every action and tx again, e.g. before filing a year,
  to see what the sources have revised or pruned since.
- `--replay <run folder>`: use exactly the records that an earlier run used, e.g.
  the run you filed.

`npx ts-node src/full-export.ts --replay ../my-tax/tax2026/2026-10-03_15-33-50 ../my-tax/wallets-config.toml`

A cache from before the store (`cache/` with one file per wallet or tx) is not read
by a run; while the store is empty, a run warns and prints the import command. Import
it into the store first; for several old caches, oldest first:

`npm run store -- import ../my-tax/store ../my-tax/tax2025/cache ../my-tax/cache`
