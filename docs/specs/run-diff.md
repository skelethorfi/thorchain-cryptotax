# Run diff

`npm run diff -- <old run> <new run>` compares the CSV rows of two runs and
says, for each row that differs, whether a change in the source data explains
it. A run is a folder under `outputPath` holding `csv/` and `snapshots.json`
(`docs/specs/snapshots.md`).

It is the check before and after a mapper change: replaying a run on new code
shows exactly which rows the code changed, and a new fetch shows which rows
the sources changed.

## Rows

- Rows come from each run's `csv/all.csv`, which holds every row.
- Two rows are the same when every column but `ID` is equal. `ID` is
  ignored, so a run from before stable IDs (`<file>:<n>`, `periods.md`) can
  still be compared with a newer one.
- Rows are compared as multisets: two identical rows in one run and one in
  the other leave one row removed.
- A removed row and an added row with the same timestamp, type, base currency,
  from and to are shown as one changed row, naming the columns that differ
  (old → new). Otherwise a row is shown as removed (`-`) or added (`+`).
- Differences are listed in time order.

## What explains a row

Each run's `snapshots.json` names the copy of every record it used. A record
differs when it is in only one run, or both runs used different copies
(different `sha256`).

A row's txids are the 64-character hex strings in its description. A
differing record explains the row when its key contains one of them (case
ignored), and the row is tagged with it, e.g. `midgard swap.<txid>: revised`.
A row no differing record explains is tagged `no record change`: the code or
the config made it differ.

When no record differs, the report says so once: every difference comes from
code or config. When the runs used different stores, the copies are still
compared by hash, so the result holds.

## Files

Each CSV file in either run is compared the same way (rows, ignoring `ID`).
For each file whose rows differ, the report gives both row counts (0 for a
file a run did not write) and how many rows are in only one run. Under it, it
lists the file's differing rows that `all.csv` has unchanged, so a row that
moves between period or wallet files (e.g. a timezone change) shows where it
left and where it landed, and every other change is listed once.

## Result

The command prints a summary (rows removed, added and changed; records that
differ) and the differences. It exits 0 when every file has the same rows,
ignoring `ID`, and 1 otherwise, so a replay check can be scripted.
