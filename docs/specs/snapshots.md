# Source data snapshots

A tax return rests on what Midgard, THORNode, Viewblock and the TCY endpoint
returned when the data was fetched. That changes after the fact:

- THORNode prunes old txs, so a later fetch can come back without the tx or
  its gas.
- Pending actions and txs (an unfinished loan repayment, a refund, an
  outbound not yet sent) are later finalised.
- Midgard instances and revisions change old actions (the loan-open amount
  fix), and history gets archived (the 2022-03-22 `genesisTx` migration).

So the tool keeps every version of every record it has fetched. Each run
picks the right version of each record, and lists what it used.

## The store

`src/cache/RecordStore.ts`, under the config's `cachePath`:

```
records/<source>/<key>/<fetchedAt>.json    one copy of one record
lists/<source>/<wallet>/<fetchedAt>.json   the record keys one fetch of a wallet returned
```

A copy is `{fetchedAt, url, sha256, data}`. The file name is `fetchedAt`
with `-` for `:`, so names sort by time.

| Source | Record | Key |
| --- | --- | --- |
| `midgard`, `maya-midgard` | an action | `<type>.<first txid>[.<contract type or swap txType>]`, or `<type>.date-<date>` with no txid |
| `thornode` | a tx status | txid |
| `thornode-cosmos` | a Cosmos tx (contract calls) | txid |
| `viewblock` | a tx | its hash |
| `tcy` | a distribution | its date (one a day) |

A record is shared: a swap between two of my wallets is stored once, and both
wallets' lists point at it. On the FY26 data, these keys are unique among
every wallet's actions.

- A fetched record is stored only if it differs from its latest copy. Nothing
  is overwritten or deleted.
- Before the comparison, each source drops fields that change on every fetch
  but are not source data: Viewblock's `usdNew` (value at today's price; `usd`,
  the value at the time of the tx, is kept), TCY's `apr` and `total`, and
  THORNode's `blocks_since_scheduled` for an outbound never signed (a switch).
- A cache from before records (`<source>/<key>.json` with the whole response)
  is imported on first use as copies with `fetchedAt: null`. Old caches need
  no migration, and the old files are left in place.

## Which copy a run uses

Copies are compared oldest first. Each later copy becomes the one used, unless
it has less in it:

| Case | Stored | Used | Manifest `choice` |
| --- | --- | --- | --- |
| One copy | – | it | `only` |
| Pending, then finalised | new copy | the finalised copy | `finalised` |
| Pruned (THORNode lost the tx or its gas; a Cosmos tx lost its events) | new copy, as evidence | **the earlier, fuller copy** | `kept-over-pruned` |
| Changed otherwise (a revision) | new copy | the new copy, and the run lists it | `revised` |
| In an earlier fetch of the wallet, but not the latest | – | the earlier copy, and the run lists it | `missing: true` |

Revisions use the new copy (decided 2026-10-03): those seen so far are
corrections. A filed year is not affected, because it replays its own manifest.

## Run modes

| Run | Fetches | Uses |
| --- | --- | --- |
| default | only lists and records never fetched | the chosen copy of each record |
| `--offline` | nothing; anything not stored is an error | the chosen copy |
| `--refresh` (or `cacheDataSources = false`) | every list and every record again | the chosen copy, with this run's fetches included |
| `--replay <run>` | nothing | exactly the copies in that run's `snapshots.json`, checked against their hashes |

`cacheDataSources = false` used to delete the whole cache. It now means
refresh, so no fetched data is destroyed.

A refresh refetches each wallet's whole history, because the sources page
from the first action. New activity, finalised records, revisions and pruned
copies all show up in one pass.

Each fetch is retried after a transient error (HTTP 5xx or 429, a connection
reset, a timeout), waiting 5 s, 20 s and then 60 s (`src/utils/Retry.ts`), and
a request that hangs fails after 60 s. A run that still fails keeps what it
stored so far, and can be run again.

## The manifest (snapshot)

Each run writes `snapshots.json` to its output folder:

- `records`: for each record used, the source, key, copy file (relative to
  `cachePath`), `fetchedAt`, `url`, `sha256`, `choice`, the number of copies
  stored, `missing` if it was kept from an earlier fetch, and `fetched` if
  this run fetched it (`new`, `changed`, `unchanged`).
- `lists`: for each wallet and source, the record keys used, in order, and
  which of them were missing from the latest fetch.

The run prints a summary: records fetched (new, changed, unchanged), and
records finalised, revised, kept over a pruned copy, or missing. It lists the
notable ones. A manifest is the snapshot: it points only at copies that never
change, so `--replay` reproduces the run exactly.

## Filing a year (separate work)

To be designed on top of this: when a year is filed, keep its manifest as the
year's record (e.g. `filed.json`) and commit it with the store, so the filed
output can always be replayed. Several years' configs may share one store,
because copies are only ever added.

## Not done

- A row-level diff between two runs, showing which record change explains
  each differing row.
