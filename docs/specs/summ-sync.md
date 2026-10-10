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
  (by default THORChain and Maya wallets). Summ
  keeps each row's `ID` (`periods.md`, Row IDs) on its leg. The sync plans
  their deletes and edits; new rows reach Summ by upload.
- **Categorised rows** are rows the exporter writes for wallets the user
  lets Summ import itself (by default BTC, ETH and other L1 wallets): the L1
  side of a swap, an LP add or a refund. They are never uploaded. The sync finds Summ's own leg for each
  (same on-chain txid, currency and amount) and edits its type and fee to
  match. It never creates or deletes a leg of Summ's own imports.

Each CSV file's chain (in its name, `periods.md`) says which kind its rows
are: chains listed in `managedChains` (default `THOR` and `MAYA`) are
managed, all others categorised. Which source a chain's rows come from is
the user's choice, by what gives the better rows: Summ may support a chain's
wallets (it has a THORChain integration) and the user still upload the
exporter's rows because Summ's import of that chain is incomplete. What must
not happen is both for one wallet: its rows would be counted twice.

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
**imports a row with a known `ID` but different data as a second row**;
a changed amount or a changed description alone is enough. The `ID` is
stored as given and shown as the leg's "Tx Hash" (a 121-character ID was
kept whole). So a changed managed row is deleted before the upload that brings its new
version.

## Package

The sync lives in `packages/summ-sync/`, with its own `package.json`, tests
and README. It imports nothing from the exporter and the exporter imports
nothing from it; the only link is the files below. It speaks MCP over
`fetch` (JSON-RPC and OAuth with PKCE, Node built-ins only).

## Commands

    summ-sync login <state dir> [--write]  # browser OAuth; token in the state dir
    summ-sync pull  <state dir> [<run dir>] [--full]  # writes a snapshot
    summ-sync plan  <state dir> <run dir>    # reads files only; calls nothing
    summ-sync apply <state dir> <plan dir> [--dry-run] [--approve-deletes] [--approve-filed]
    summ-sync prune <state dir> [--keep <n>]  # removes committed files no recent snapshot needs
    summ-sync migrate <state dir>             # one-off: old snapshot folders to the store

The **state dir** holds the action store, snapshots, plans, apply logs, the
adoption table and the overrides file. It is the user's private data: never
in this repo. It is meant to be kept in git (prune relies on it).

## State dir

    actions/<action id>.json    one action's JSON and change history, written once
    snapshots/<time>.json       one pull: counts, and one entry per listed action
    plans/<time>/               plan.json, plan.md, upload/
    adopted.csv, overrides.json, apply-log.jsonl, summ-sync.json

**Action store.** Summ's action ids are database ids made when the action
is (re)built, and every write rebuilds it, so what the sync reads of an
action never changes under the same id: its legs (all fields plan reads)
and its change history entries. An id's detail is therefore fetched and
written once, by pull or by apply, and never rewritten. Other fields do
move under the same id (`lastModified`, `updatedAt`, `balanceSnapshot`,
`sortPriority`), as does the history's "_N earlier versions not read._"
line; the stored file keeps them as first read, and nothing reads them.

**Snapshot file.** A pull's counts (the list's reported total, parsed and
unique counts, managed sources, the run dir, how many details were fetched
and how many the store already held), then one entry per listed action:
`id`, `txHash`, `category`, `tags`, and `detail: true` when the action is
one the plan needs (below). The file is written whole at the end of the
pull, so a pull that stops leaves no snapshot. The list pages themselves are
not kept. An action deleted in Summ is simply absent from later snapshots;
its stored detail stays.

**Prune** removes snapshot files other than the latest `n` (default 3) and
store files that none of the kept snapshots lists, but only files git
tracks with no uncommitted changes (git keeps them); otherwise it removes
nothing and lists the files. Plans keep their snapshot's name.

**Migrate** reads each old snapshot folder (`snapshots/<time>/` with
`actions.jsonl`, `details/` and `manifest.json`) and each `deleted/<time>/`
folder, writes the store files and `snapshots/<time>.json`, and reports
any id whose copies differ in what the sync reads. It leaves the old
folders for the user to remove once a plan from the new layout matches.

## Inputs

**Run folder** (written by the exporter): the desired state is its period
wallet files, `csv/<from>_<to>_<CHAIN>_<wallet>_<name>.csv` (`periods.md`),
the files the user uploads. `csv/all.csv` is not read: it holds rows outside
the run's periods. `row-ids.csv` traces an `ID` back to its action for the
user; plan does not need it. No other file is written for the sync. A row's
on-chain txids are the 64-character hex strings in its description (as
`run-diff.md`); a payout to an L1 wallet names its outbound txid there too
(`fees.md`, Txids in descriptions).

**Snapshot** (written by `pull`, State dir above): every listed action,
and the detail of each action the plan needs: every action of a managed
source, and, when pull is given the run dir, every action whose tx hash is
a txid of a categorised row. Pull fetches only the details the store lacks.
`pull --full` fetches every needed detail again and reports each stored id
whose legs or change history entries differ from Summ's (which would
disprove the store's premise); it then replaces that store file. A snapshot
is never patched: after an apply, pull again.

**Sync config** (`summ-sync.json` in the state dir):

- `filedBefore`: rows before this date belong to filed years; changing them
  is an amendment (below).
- `managedChains`: the chains whose files the user uploads, so their rows
  are managed (default `["THOR", "MAYA"]`). A chain not listed is left to
  Summ's own import of its wallets.
- `managedSources`: Summ's source names of the managed rows (e.g. the
  account name the CSVs were uploaded under).
- `timezone`: the Summ account's timezone (IANA name, default `UTC`): the
  days of the run's periods and of `filedBefore`, as the exporter's
  `timezone` (`periods.md`).

## Matching

**Scope.** Summ holds every year; a run holds its periods. A managed leg
that matches no row is only planned for deletion when its timestamp falls
in one of the run's periods (whole days in `timezone`); one outside them is
left alone and counted.

**Managed rows** match the Summ legs of a managed source with the same `id`.
A row is in Summ as a base leg (the type's side), a quote leg on the other
side for `buy` and `sell` only (Summ keeps no leg for the quote of other
types, e.g. `bridge-trade-out`), and a leg in `fees` when the row has a fee,
all carrying the row's `ID`.

Rows uploaded before stable IDs carry `<file>:<n>`: plan adopts each such
leg to the one unmatched row with the same base leg (type, currency, amount,
timestamp to the second) and, when the leg's description holds txids (old
descriptions often do not), the same txids. It records each adopted leg in
`adopted.csv` in the state dir (`Leg,ID`: leg `_id`, row ID); later plans
match the leg through that table, so a later change of the row is an edit,
not a re-upload. An in-scope legacy leg that fits no row is planned for
deletion like any other. One that fits several rows, or a row that several
legacy legs fit, is reported, and those rows are not uploaded.

**Categorised rows** match a leg of Summ's own imports whose tx hash is a
txid of the row, with the same currency, and an amount equal to the row's
or the row's plus its fee (Summ records the gross amount on some chains).
Exactly one leg must match; none or several is reported, not guessed.

**Made-up legs.** Summ pairs a send of its own imports with a receive
it makes up itself (source `manual`, import type `soft-transfer`, to an
account such as "THORChain"), so the send is a transfer that disposes of
nothing; a receive it pairs with a made-up send (withdrawal from such an
account). Once the leg is categorised as anything but a plain send or
receive, Summ splits the made-up leg off as an action of its own
(`unmatchedTransfer`), and the asset counts twice. So plan lists each such leg (same txid and
currency, not yet ignored) with the categorised row, and apply ignores
it. A made-up leg is never matched to a categorised row.

## Compared fields

Type, base currency and amount, quote currency and amount (buy and sell),
fee currency and amount, timestamp (to the second), blockchain, from and to
(managed rows only), and the description (managed rows with a stable ID; an
adopted leg keeps its old wording). Not price, value or gain.

A changed shape (a leg on the other side, a quote or fee leg gained or
lost), currency or description cannot be an edit (the MCP rejects custom
currencies such as LP tokens, and cannot set descriptions), so such a row is
deleted and uploaded again. The other fields are edits.

The CSV's blockchain names are mapped to Summ's ids by a table in the
package (`THORChain` → `thorchain`, `BNB` → `binancechain`, ...); a chain
the table lacks is not compared, and the plan says which. CSV types are compared as Summ's enum
(`bridge-trade-out` → `bridgeTradeOut`, `receive-lp-token` →
`receivingLiquidityProviderToken`, ...); the mapping table is part of the
package and a type it lacks stops the plan.

Amounts are equal when they differ by less than `1e-8` of the amount, or
by at most one unit at the 8th decimal: the exporter's amounts carry
THORChain's 8 decimals, while Summ's own imports hold e.g. ETH gas in full.

## Plan

`plan` writes `plans/<timestamp>/plan.json` (machine-readable, the input to
`apply`), `plan.md` (for review) and `upload/`, and adds what it adopted
and captured to `adopted.csv` and `overrides.json`. It changes nothing in
Summ. Each change names the row `ID`, the leg `_id`, the field, Summ's
value and the desired value; each delete names the legs and how many other
legs share their actions (a delete by action would remove those too).

| Section | Contents | Applied as |
| --- | --- | --- |
| delete | managed legs with no row in the run; managed legs whose row changed in a field an edit cannot set (description, ID) or whose action shape changed | bulk delete, only with `--approve-deletes` |
| edit | managed legs whose row changed only in editable fields | `edit_transaction` per action |
| upload | rows with no leg in Summ after the deletes, per CSV file | files written to `plans/<timestamp>/upload/` (the file's header and those rows as the run wrote them; filed-year rows in `<file>_filed.csv`), uploaded by the user |
| categorise | categorised rows whose Summ leg differs in type or fee | `edit_transaction` |
| report | categorised rows with no or several matching legs; legacy legs that fit several rows; managed rows whose ID Summ holds under a source not in `managedSources` (not uploaded again); manual entries repeating a row's txid | nothing: for the user to resolve |
| overridden | differences an override keeps, and overrides captured in this plan | nothing |

**Filed years.** An entry whose row or leg is dated before `filedBefore` is
an amendment: listed under its own heading in each section and applied only
with `--approve-filed`, in a separate apply from the current year.

**Drift and overrides.** A value the user changed in Summ is kept, never
set back by default. Summ's change history labels every edit through the
MCP as the user's, so an edit is the sync's own when `apply-log.jsonl`
records it (same leg, field and value), and drift otherwise. The history is
per action, in the web app's labels (`Category`, `Quantity`, `From`, ...),
so a difference counts as drift when its action's history has a `user`
change of that field's label: an edit of another leg in the same action
(e.g. the other side of a transfer) can make it drift too. `plan`
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

1. Check the plan's snapshot is the latest, and that `apply-log.jsonl`
   records no write since that snapshot was taken; refuse otherwise (pull
   and plan again).
2. Deletes (approved). Each leg is looked up again by `_id`, and only
   actions that now hold nothing but the entry's legs are deleted, by
   their action ids. A delete whose legs share an action with other legs
   (in the plan or in Summ now) is skipped and reported. Never by a
   filter: Summ's `id` filter lists the leg's action but can list
   unrelated actions too, even with `showAssociated: 0`, so a look-up
   inspects each action it lists and keeps only the one holding the leg.
   Summ cannot undo a delete, so apply first saves each action as it
   just inspected it to the store (`actions/<action id>.json`, unless the
   store already holds that id), and the log line names the file. A deleted row comes back by
   uploading its CSV line again; the saved file shows what Summ held.
3. Edits and categorisation. Before each action, look it up again by leg
   `_id` (action ids change after every write) and check the leg still
   holds the plan's "Summ value"; a leg that changed since the pull is
   skipped and reported. All changes of one action go in one
   `edit_transaction`.
   Then each made-up leg of the row is looked up again by `_id`
   (waiting a few seconds for Summ to split it off) and ignored by its
   action id, only when that action holds nothing else; if the edit was
   skipped, so is the ignore. An undo handle cannot be relied on to back
   out of this: once Summ re-pairs the categorised leg with another
   (e.g. an uploaded bridge-trade-in), the edit's handle is stale.
4. Print the upload files for the user to upload.
5. Write `apply-log.jsonl` as it goes: each call, its result and its undo
   handle, one line per changed field (`legId`, `field`, `value`) for
   plan's drift check, and each skip.

While the plan has uploads (for the years this apply covers), apply holds
back categorisation: Summ pairs a categorised leg with the other side of
its swap only when that side is already in Summ, so the user uploads first
and runs pull, plan and apply again.

An apply carries out the current years' entries, or with `--approve-filed`
only the filed years'. `--dry-run` does steps 1 to 3 with read tools only
and writes nothing.

Then `pull` and `plan` again: the plan should be empty, apart from what the
upload adds once done.

## Not done here

- Creating rows through the MCP (see above). Revisit if Summ's MCP accepts
  custom currencies, an ID and a description.
- Pairing legs. Summ's own matching pairs them; an unpaired leg shows as a
  report entry (Summ's `unmatchedTransfer` warning).
- Prices and gains.

## Open

- Whether a categorised leg's amount is gross or net of the fee, per chain.
