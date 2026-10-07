# Periods and CSV files

A run splits its rows into periods (`fromDate`, `toDate`, `frequency`) and
writes, for each period, one CSV per wallet for Summ to import, plus
`all-<from>_<to>.csv`. `all.csv` holds every row, whatever its date. The
layout is `csvFiles` in `src/export/summ/files.ts`.

## Required behaviour

- A period is made of whole calendar days: it starts at midnight at the start
  of `fromDate` and ends at midnight at the end of `toDate`. A row at
  23:59 on the last day is in the period.
- The days are those of the config's `timezone`, an IANA name such as
  `Europe/London`. Without it they are UTC days, as before the key existed.
- Daylight saving is followed: in New York a period ending 30 June ends at
  04:00 UTC on 1 July (UTC-4), one ending 31 December at 05:00 UTC on
  1 January (UTC-5).
- When `toDate` is left out it is today's date in that timezone (UTC
  without the key).
- An unknown timezone name stops the run before anything is fetched.
- File names keep the period's dates (`2025-07-01_2026-06-30_…`); the
  timezone does not appear in them.

## Why

Summ assigns a row to a tax year by its timestamp in the account's timezone.
In a zone nine hours ahead of UTC (`Asia/Tokyo`), a year ending 30 June ends
at 15:00 UTC. With UTC periods, a row between 15:00 and 24:00 UTC on 30 June
is in Summ's next year but in the earlier year's file (in a zone behind UTC
the mismatch is at the start of 1 July instead). A year's files then hold rows of the next year, and a row of the next
year is missed if the earlier year was uploaded before it was exported. With
the account's timezone set, each period file holds exactly the rows Summ
counts in that period.

The period only decides which upload a row is in; Summ still dates each row
by its own timestamp.

## Row IDs

Each row's `ID` column says what the row is, never its amounts or wording:

    <action time>.<role>.<hash>
    2023-01-06T21:53:15.332Z.kept.1c69b789c6c0

- **Action time**: the action's own time (UTC), so the rows of one action
  sort together, also when a row's timestamp is offset (the LP token and
  price-helper rows are 10 and 20 seconds later).
- **Role**: what the row is in the action, one of `trade-out`, `trade-in`,
  `bridge-out`, `bridge-in`, `add`, `remove`, `lp-in`, `lp-out`,
  `price-helper`, `failed-out`, `kept` (what a refund did not return, as
  `Fee` or `Lost`), `send`, `receive`, `bond`, `unbond`, `stake`, `unstake`,
  `claim`, `income`, `name-fee`, `loan`, `repay`, `collateral-deposit`,
  `collateral-withdrawal`.
- **Hash**: the first 12 hex digits of SHA-256 over `v1|<record>|<wallet>|
  <role>|<asset>`: the action's store record key (source, type, txid, and
  the contract event or members where they tell actions apart,
  `snapshots.md`), the row's wallet, the role, and the leg's asset as the
  source names it (`BTC.BTC`) when an action has a row of the role per
  asset. Twelve hex digits only have to tell apart the rows that share a
  time and role.

A row has the same ID in every file it is in and in every run. Summ shows it
as the "Tx Hash", and keeps it on each leg, so a row in Summ is traced back by
its ID: each run writes `row-ids.csv` next to `csv/` (not uploaded), with each
ID's timestamp, type, wallet, record, role and asset. An ID changes only when
what the row is changes (e.g. a mapper fix splits a row); `v1` changes if the
format ever does. Two rows with one ID are a mapper bug, and stop the run.

Summ is not known to de-duplicate on the ID when a file is uploaded again, so
nothing relies on it.

## History

- Before October 2026 the ID was `<file>:<n>`, numbered from the oldest row in
  the file, so one added row renumbered every newer row; then briefly
  `<action time>.<mapper's name>` with `.2` for a repeat.
- Before October 2026, periods ended at 00:00 UTC on their last day, so a
  row later that day was in no period file (only in `all.csv`).
- October 2026: periods include their whole last day (UTC), and the
  `timezone` key was added.
