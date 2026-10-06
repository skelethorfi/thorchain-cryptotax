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
  `Australia/Melbourne`. Without it they are UTC days, as before the key
  existed.
- Daylight saving is followed: in Melbourne a period ending 30 June ends at
  14:00 UTC (UTC+10), one ending 31 December at 13:00 UTC (UTC+11).
- When `toDate` is left out it is today's date in that timezone.
- An unknown timezone name stops the run before anything is fetched.
- File names keep the period's dates (`2025-07-01_2026-06-30_…`); the
  timezone does not appear in them.

## Why

Summ assigns a row to a tax year by its timestamp in the account's timezone.
For an Australian account a financial year ends at midnight local time on
30 June, which is 14:00 UTC. With UTC periods, a row between 14:00 and 24:00
UTC on 30 June is in Summ's next financial year but in the earlier year's
file. A year's files then hold rows of the next year, and a row of the next
year is missed if the earlier year was uploaded before it was exported. With
the account's timezone set, each period file holds exactly the rows Summ
counts in that period.

The period only decides which upload a row is in; Summ still dates each row
by its own timestamp.

## History

- Before October 2026, periods ended at 00:00 UTC on their last day, so a
  row later that day was in no period file (only in `all.csv`).
- October 2026: periods include their whole last day (UTC), and the
  `timezone` key was added.
