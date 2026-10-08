# Summ sync

Keeps Summ matching a run's output, like Terraform: **pull** Summ's state,
**plan** the differences against the run (the desired state), review the
plan, **apply** it, and pull again. A second plan right after an apply is
empty.

It moves no tax treatment of its own. It makes Summ hold the rows the
exporter wrote, so every disposal, acquisition, income and fee in Summ is
the one the source data gives. Summ still prices every row and computes
every gain; the sync never compares or writes fiat values.

## Two kinds of rows

- **Managed rows** come from the exporter's CSVs that the operator uploads
  (THORChain and Maya wallets: chains Summ does not import itself). Summ
  keeps each row's `ID` (`periods.md`, Row IDs) on its leg. The sync plans
  their deletes and edits; new rows reach Summ by upload.
- **Categorised rows** are rows the exporter writes for wallets Summ imports
  itself (BTC, ETH and other L1 wallets): the L1 side of a swap, an LP add or
  a refund. They are never uploaded. The sync finds Summ's own leg for each
  (same on-chain txid, currency and amount) and edits its type and fee to
  match. It never creates or deletes a leg of Summ's own imports.

Each CSV file's chain (in its name, `periods.md`) says which kind its rows
are: chains listed in `managedChains` (default `THOR` and `MAYA`) are
managed, all others categorised. A chain moves to categorised if Summ starts
importing its wallets itself, or the uploaded rows would repeat Summ's own.

## What Summ's MCP allows

Summ's MCP server (`mcp.summ.com`, OAuth with the `mcp:read` and
`mcp:write` scopes) is the only interface used. What it can and cannot do
decides the design:

- Read: every action, page by page, and each action's full JSON (legs with
  `_id`, `id`, `description`, `trade`, `importType`, fee legs, comments,
  change history).
- Edit one leg: type, currency, quantity, price, from, to, timestamp,
  blockchain, reviewed. Not the description, the ID or tags. Every edit
  rebuilds the action, so **action ids change on every write**; a leg's
  `_id` does not.
- Bulk: recategorise, ignore, comment, tag, change currency, value or
  account, and **delete (permanent, no undo)**. Edits other than delete
  return an undo handle.
- Create: manual entries only, with no `ID` or description, and no custom
  currencies (LP tokens and other assets created by a CSV import are
  rejected). So the sync does not create rows: the operator uploads CSVs.
- No tool groups two legs into one action: Summ pairs transfers and bridges
  itself, by time and amount.

On upload, Summ skips a row whose `ID` and data equal a row it holds, and
**imports a row with a known `ID` but different data as a second row**.
So a changed managed row is deleted before the upload that brings its new
version.

## Package

The sync lives in `packages/summ-sync/`, with its own `package.json`, tests
and README. It imports nothing from the exporter and the exporter imports
nothing from it; the only link is the files below. It speaks MCP over
`fetch` (JSON-RPC and OAuth with PKCE, Node built-ins only).

## Commands

    summ-sync login <state dir> [--write]  # browser OAuth; token in the state dir
    summ-sync pull  <state dir>    # writes a snapshot
    summ-sync plan  <state dir> <run dir>
    summ-sync apply <state dir> <plan file> [--approve-deletes] [--approve-filed]

The **state dir** holds snapshots, plans, apply logs, the adoption table and
the overrides file. It is the user's private data: never in this repo.

## Inputs

**Run folder** (written by the exporter): `csv/*.csv` per wallet and period,
`csv/all.csv`, and `row-ids.csv` (each `ID`'s timestamp, type, wallet,
record, role and asset). A row's on-chain txids are the 64-character hex
strings in its description (as `run-diff.md`).

**Snapshot** (written by `pull`): `actions.jsonl` (one line per action from
the list) and `details/<action id>.json` (the action's JSON and change
history) for each action the plan needs: every action of a managed source,
and every action whose tx hash is a txid of a categorised row. A snapshot is never patched: after an apply, pull
again.

**Sync config** (`summ-sync.json` in the state dir):

- `filedBefore`: rows before this date belong to filed years; changing them
  is an amendment (below).
- `managedChains`: the chains whose files are managed (default
  `["THOR", "MAYA"]`).
- `managedSources`: Summ's source names of the managed rows (e.g. the
  account name the CSVs were uploaded under).

## Matching

**Managed rows** match a Summ leg of a managed source with the same `id`.
Rows uploaded before stable IDs carry `<file>:<n>`: the first plan adopts
each such leg to the row with the same txid in its description, timestamp,
type, currency and amount, and records it in `adopted.csv` (leg `_id`,
stable ID). An adopted leg is then matched through that table. A legacy leg
that matches no row is planned for deletion like any other.

**Categorised rows** match a leg of Summ's own imports whose tx hash is a
txid of the row, with the same currency, and an amount equal to the row's
or the row's plus its fee (Summ records the gross amount on some chains).
Exactly one leg must match; none or several is reported, not guessed.

## Compared fields

Type, base currency and amount, quote currency and amount, fee currency and
amount, timestamp (to the second), blockchain, from and to (managed rows
only). Not price, value or gain. CSV types are compared as Summ's enum
(`bridge-trade-out` → `bridgeTradeOut`, `receive-lp-token` →
`receivingLiquidityProviderToken`, ...); the mapping table is part of the
package and a type it lacks stops the plan.

Amounts are compared to the precision Summ stores; a difference below
`1e-8` of the amount is equal.

## Plan

`plan` writes `plans/<timestamp>/plan.json` (machine-readable, the input to
`apply`) and `plan.md` (for review), and nothing else. Each entry names the
row `ID`, the leg `_id`, the field, Summ's value and the desired value.

| Section | Contents | Applied as |
| --- | --- | --- |
| delete | managed legs with no row in the run; managed legs whose row changed in a field an edit cannot set (description, ID) or whose action shape changed | bulk delete, only with `--approve-deletes` |
| edit | managed legs whose row changed only in editable fields | `edit_transaction` per action |
| upload | rows with no leg in Summ after the deletes, per CSV file | files written to `plans/<timestamp>/upload/`, uploaded by the user |
| categorise | categorised rows whose Summ leg differs in type or fee | `edit_transaction` |
| report | categorised rows with no or several matching legs; Summ legs of a managed source that no ID explains; manual entries repeating a row's txid | nothing: for the user to resolve |
| overridden | differences an override keeps, and overrides captured in this plan | nothing |

**Filed years.** An entry whose row or leg is dated before `filedBefore` is
an amendment: listed under its own heading in each section and applied only
with `--approve-filed`, in a separate apply from the current year.

**Drift and overrides.** A value the user changed in Summ is kept, never
set back by default. Summ's change history labels every edit through the
MCP as the user's, so an edit is the sync's own when `apply-log.jsonl`
records it (same leg, field and value), and drift otherwise. `plan`
records each one it has not seen before in `overrides.json` in the state
dir: row `ID`, field, the run's value, the user's value, when it was seen,
and a `reason` for the user to fill in. An override always takes precedence
over the run, so the plan shows no change for it. To have the plan revert a
field, the user deletes its entry; the next plan then sets it back (and
captures nothing, since the apply's edit is the sync's own).

Each plan lists, under overridden, the overrides it captured for the first
time (so an unintended edit in Summ is seen once) and every override whose
run value has changed since it was captured (the source data or the
mapper moved under it; the override still wins until the user decides).
An override whose row or leg no longer exists is reported and left for the
user to delete.

## Apply

In this order, stopping at the first failure:

1. Check the plan's snapshot is the latest; refuse an older plan.
2. Deletes (approved), by the leg `_id`s, never by a filter.
3. Edits and categorisation. Before each action, look it up again by leg
   `_id` (action ids change after every write) and check the leg still
   holds the plan's "Summ value"; a leg that changed since the pull is
   skipped and reported.
4. Print the upload files for the user to upload.
5. Write `apply-log.jsonl`: each call, its result and its undo handle.

Then `pull` and `plan` again: the plan should be empty, apart from what the
upload adds once done.

## Not done here

- Creating rows through the MCP (see above). Revisit if Summ's MCP accepts
  custom currencies, an ID and a description.
- Pairing legs. Summ's own matching pairs them; an unpaired leg shows as a
  report entry (Summ's `unmatchedTransfer` warning).
- Prices and gains.

## Open

- Which fields Summ compares when it calls an uploaded row identical. Until
  known, upload files hold only rows Summ lacks, never a whole file again.
- Whether a categorised leg's amount is gross or net of the fee, per chain.
