# Actions that are not final

Midgard gives each action a status. Only `success` is final: `pending` means
THORChain or Maya has not finished it (an outbound not sent yet, a refund not
paid out, a loan not closed). Most finish within minutes; some never do, e.g.
a refund that could not be paid out. A run must not drop these silently.

## Age

An action's age counts from its own date, not from when it was fetched.

| Age | When | Why |
| --- | --- | --- |
| recent | younger than `pendingGraceDays` (config, default 3) | it may still finish |
| waiting | between the two | unusual: check it |
| stuck | `pendingStuckDays` (config, default 30) or older | it will not finish |

The grace period covers the slowest normal case: a streaming swap runs at most
14,400 blocks (about a day), and an outbound then waits at most 17,280 blocks
(about 29 hours); a limit swap waits at most 43,200 blocks (about 3 days).
A chain halt can hold outbounds longer, which the 30 days allow for.

The same cut-off stops a run fetching a stuck THORNode or Cosmos tx again
(`snapshots.md`).

## What a run does

| Action | Exported |
| --- | --- |
| pending loan repayment | yes (`loans.md`) |
| pending loan open with an output | yes: it was paid out (`loans.md`) |
| any other action that is not `success` | no |

Every action that is not `success`, exported or not, is listed once in the run
summary's Not final section (`run-summary.md`), oldest first, with its status,
age in days, whether it is recent, waiting or stuck, whether it was exported,
and its store record key. The Counts section gives the totals by age.

Planned: a stuck refund or swap-and-add that sent funds and returned nothing is
exported as `lost` for the amount sent, plus its gas as a fee, with a warning
to review it.
