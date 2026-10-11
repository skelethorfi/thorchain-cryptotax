# Run summary

Each run writes `summary.md` to its folder, next to `csv/`, `snapshots.json`,
`unsupported/` and `failures/`. It keeps what the run printed that is worth
reading later, so a run (and a filed year) still shows what was flagged
after the terminal is gone. The run prints the same lines as before.

| Section | What |
| --- | --- |
| Run | the config, start time, period and timezone, protocols, and the mode (fetch, refetch all, offline, or the run replayed) with the store |
| Counts | actions that are not final, by age; actions skipped (listed for an earlier wallet; sends that are another action's inbound), rows exported, the snapshot summary and the records found changed or missing |
| Warnings | warnings about the whole run: config keys no longer used, an old cache, wallets missing from the config, and the end-of-run warnings (e.g. sends with an action memo, `sends.md`) |
| Enter by hand | actions to enter by hand, with their message |
| Action warnings | warnings on one action |
| Not final | every Midgard action whose status is not `success`, oldest first: its status, age, whether it is recent, waiting or stuck, and whether it was exported, what covers it, or which send stands in for it (`pending.md`) |
| Unsupported actions | actions with no mapper; each is saved in `unsupported/` |
| Failed actions | actions whose mapper failed, with the error; each is saved in `failures/` |

Each line about one action ends with its store record key (e.g.
`midgard/swap.<txid>`), which says which action it was. A section with
nothing in it is left out; the issue and warning sections give their count.
