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

Each row's `ID` column depends only on the action it comes from: the action's
time and the row's role, e.g. `2023-01-06T21:53:15.332Z.refund-lost` or
`<time>.thorchain.bridge-trade-out`. A row has the same ID in every file it is
in (`all.csv`, the period's `all-…` file, its wallet's file) and in every run,
so a row in Summ (which shows the ID as the "Tx Hash") is found in the CSVs by
searching for its ID, and re-exporting a year does not change the IDs of rows
that did not change. When two rows would get the same ID (two actions in one
block), the second and later get `.2`, `.3`, …, in the order of the rows'
contents. A row with no ID from its mapper gets `<time>.<type>`.

Before October 2026 the ID was `<file>:<n>`, numbered from the oldest row in
the file, so one added row renumbered every newer row.

## History

- Before October 2026, periods ended at 00:00 UTC on their last day, so a
  row later that day was in no period file (only in `all.csv`).
- October 2026: periods include their whole last day (UTC), and the
  `timezone` key was added.
