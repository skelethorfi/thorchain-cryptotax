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

Relative `outputPath`, `cachePath` and `unsupportedActionsPath` values in a config
are relative to the config file's folder, so the output and cache are written next to
your config, not into the repo.

### Re-running from the cache

With `cacheDataSources = true`, the downloaded API responses are kept in the cache folder.
Midgard and THORNode responses can change over time, so keep the cache from the run you
used for your tax return.

To re-run exactly from that cache, without any network requests:

`npx ts-node src/full-export.ts --offline ../my-tax/wallets-config.toml`

Anything missing from the cache is an error rather than a new download.
