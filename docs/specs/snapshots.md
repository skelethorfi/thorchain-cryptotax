# Source data snapshots

A tax return rests on what Midgard, THORNode, Viewblock and the TCY endpoint
returned when the data was fetched. That changes after the fact:

- THORNode prunes old txs, so a later fetch can come back without the gas.
- Midgard instances and revisions disagree, and history gets archived (the
  2022-03-22 `genesisTx` migration, the loan-open amount fix).

So a fetch is evidence that may not be obtainable again. It is kept, never
replaced, and every run records which data it used.

## Layout

`src/cache/Cache.ts`. One folder per source under the config's `cachePath`
(`midgard`, `maya-midgard`, `thornode`, `thornode-cosmos`, `viewblock`, `tcy`),
then one folder per key (a wallet or a txid), then one file per fetch:

```
<cachePath>/<source>/<key>/<fetchedAt>.json
{"snapshot": {"fetchedAt": "...", "url": "...", "sha256": "..."}, "data": ...}
```

- `fetchedAt` is the fetch time in UTC; the file name is the same time with `-`
  for `:`, so names sort by time.
- `sha256` is the hash of `JSON.stringify(data)`.
- A fetch is saved only if its hash differs from the latest snapshot of the key.
  A file is never overwritten or deleted by the tool.
- A cache from before snapshots, `<source>/<key>.json` holding only the data,
  is read as the oldest snapshot of that key, with `fetchedAt: null`. Old
  caches need no migration.

## Which snapshot a run reads

| Run | Reads | Fetches |
| --- | --- | --- |
| default | the latest snapshot of each key | only keys with no snapshot |
| `--offline` | the latest snapshot | nothing; a missing key is an error |
| `--refresh` (or `cacheDataSources = false`) | a new fetch for wallet-level keys, the latest snapshot otherwise | wallet-level keys, and keys with no snapshot |
| `--replay <run>` | exactly the snapshots in that run's `snapshots.json`, checked against their hashes | nothing |

Only wallet-level data is refreshed: Midgard actions, Viewblock txs and TCY
distributions grow with new activity, and revisions can change them. A single
tx's record (THORNode tx status, Cosmos tx) cannot gain anything from a
refetch, only lose detail to pruning, so it is fetched once.

`cacheDataSources = false` used to delete the whole cache before a run. It now
means refresh, so no evidence is destroyed.

Fields that change on every fetch but are not source data are dropped before
saving, so that a refresh reports only real changes:

- Viewblock's `usdNew`, an amount's value at today's price (`usd`, the value
  at the time of the tx, is kept);
- TCY's `apr`, today's rate.

The first refresh after this change reports each such key as changed once.

## The manifest

Each run writes `snapshots.json` to its output folder: one entry per key it
read or fetched, with the source, the key, the snapshot file (relative to
`cachePath`), `fetchedAt`, `url`, `sha256` and a status:

- `cached`: read from an earlier fetch;
- `fetched`: the first fetch of the key;
- `unchanged`: fetched again, the same as the latest snapshot;
- `changed`: fetched again and different, so saved as a new snapshot.

The run prints how many keys changed, and lists them.

## Filing a year

Commit the year's output (with its `snapshots.json`) and its cache. Then
`--replay <run>` reproduces the filed output exactly. A later `--refresh`
shows whether the sources have changed since, without touching the snapshots
the filed run used.

## Not done

- A row-level diff between two runs, and which source change explains each
  differing row (backlog: whole-run diff).
- Retries for transient network errors: a refresh that fails part-way leaves
  the snapshots fetched so far, and writes no manifest.
