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
| covered: a successful action in the wallet's list has the same inbound txid | no: that action accounts for it |
| stuck refund, not covered | yes: `FailedOut` and `Lost` (below) |
| stuck swap that paid nothing out, not covered | yes: as a stuck refund (below) |
| any other action that is not `success` | no |

**Covered.** Midgard lists a savers deposit as a successful `addLiquidity`
plus a `swap` (memo `+:BTC/BTC`, `txType` `add`) to the synth that stays
pending; and a partially filled swap as a successful swap plus a pending
refund. The successful action carries the whole event, so the pending one is
not exported. A send does not cover: it is how the wallet paid (e.g. the RUNE
sent to Maya's vault for a Maya action), not what came of it.

**Stuck refund.** The wallet sent an amount and the refund was never paid out
(e.g. a dust withdraw request, a refund too small for its outbound fee, a
refund while trading was halted). It is exported like any refund
(`fees.md`): a `FailedOut` for the amount sent, carrying the gas the wallet
paid, and the amount not returned as **`Lost`** instead of `Fee` (described
"never paid out (still pending)"): a disposal with no proceeds. The action
gets a warning to check that it never came back. The amount sent and the gas
are observed on-chain; that it is lost is assumed from Midgard's status.

A pending refund younger than the cut-off is not exported: it may still be
paid out.

**Stuck swap.** A swap (not a loan) still pending past the cut-off, not
covered, with no coins paid out: the wallet sent its coin and nothing came
back, which is a stuck refund under another name. It gives the same rows, a
`FailedOut` with the gas and a `Lost` for the amount sent, described
`swap (<txid>): …`, and the same warning. A stuck swap that paid some coins
out is listed but not exported: check it by hand.

Every action that is not `success`, exported or not, is listed once in the run
summary's Not final section (`run-summary.md`), oldest first, with its status,
age in days, whether it is recent, waiting or stuck, whether it was exported or
what covers it, and its store record key. The Counts section gives the totals.

Golden case: `refund/btc-pending-never-paid`.
