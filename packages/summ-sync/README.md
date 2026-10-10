# summ-sync

Keeps [Summ](https://summ.com) matching a set of Summ CSV files, like
Terraform: pull Summ's state, plan the differences, apply them, pull again.
The design is `docs/specs/summ-sync.md` in this repo.

It is a separate package: it reads files (Summ CSVs with stable `ID`s and a
`row-ids.csv`), not the exporter's code, and needs no runtime dependencies.
It is TypeScript that Node 24 runs directly (type stripping, so only
erasable syntax: no enums or namespaces); `tsc` from the repo root checks it. It talks to Summ only through Summ's MCP server
(`https://mcp.summ.com/mcp`), with your own login.

Status: experimental. `login`, `pull`, `plan` and `apply` work; review every
plan before you apply it.

## A year's sync

1. Export the year with the exporter (a run dir with `csv/`).
2. `login <state dir> --write` once (the token is refreshed after that).
3. `pull <state dir> <run dir>`, then `plan <state dir> <run dir>`. Read `plan.md`.
4. `apply <state dir> <plan dir>` (`--dry-run` first; `--approve-deletes` if the
   plan deletes). It deletes and edits, and holds back categorisation while the
   plan has uploads.
5. Upload the files in `<plan dir>/upload/` to Summ, under the account named
   in `managedSources`. They hold only the rows Summ lacks.
6. `pull`, `plan`, `apply` again: it categorises Summ's own legs, now that
   Summ can pair them with the uploaded rows, and ignores the receives Summ
   made up to pair a send as a transfer.
7. `pull` and `plan`: what is left is under Report, for you to resolve.

Filed years go in a separate apply with `--approve-filed`.

## Usage

    node packages/summ-sync/bin/summ-sync.ts login <state dir> [--write]
    node packages/summ-sync/bin/summ-sync.ts pull  <state dir> [<run dir>] [--full]
    node packages/summ-sync/bin/summ-sync.ts plan  <state dir> <run dir>
    node packages/summ-sync/bin/summ-sync.ts apply <state dir> <plan dir> [--dry-run] [--approve-deletes] [--approve-filed]
    node packages/summ-sync/bin/summ-sync.ts prune <state dir> [--older-than <days>]
    node packages/summ-sync/bin/summ-sync.ts tools <state dir>

- `login` opens the browser to authorise this tool (scope `mcp:read`, or
  `mcp:read mcp:write` with `--write`) and keeps the token in
  `<state dir>/.auth.json` (mode 600).
- `pull` writes `<state dir>/snapshots/<timestamp>.json`: the counts and
  one entry per listed action (id, tx hash, category, tags). The full JSON
  and change history of each action of a managed source goes to the action
  store, `<state dir>/actions/<action id>.json`. Given a run dir, it also
  stores the detail of each action whose tx hash is a txid of the run's
  categorised rows (chains not in `managedChains`). Summ gives an action a
  new id whenever it changes, so an id is fetched once and only ids the
  store lacks are fetched; `--full` fetches them all again (e.g. before
  filing a year) and warns about any stored id whose legs or history
  differ.
- `plan` compares the run's period wallet files with the latest snapshot
  and writes `<state dir>/plans/<timestamp>/`: `plan.json`, `plan.md` and
  `upload/` (the rows Summ lacks, per file). It calls nothing. It adds the
  legs it adopted (old `<file>:<n>` IDs) to `adopted.csv`, and the values
  you changed in Summ to `overrides.json`, where they win over the run until
  you delete them.
- `apply` carries out a plan made from the latest snapshot: deletes (only
  with `--approve-deletes`), then edits and categorisation, each checked
  against Summ's current value first (categorisation waits while the plan
  has uploads); then it lists the upload files. It
  applies the current years' entries, or with `--approve-filed` only the
  filed years'. `--dry-run` does the look-ups and checks with read tools
  only and writes nothing. Every write goes to `<state dir>/apply-log.jsonl`
  with its undo handle (`undo_edit`; deletes have none). Before a delete,
  it saves each action as it inspected it (full JSON and change history) to
  the action store, `<state dir>/actions/<action id>.json`. Summ cannot undo a delete
  and the MCP cannot recreate an uploaded row, so to bring a row back,
  upload its CSV line again (from the run that wrote it); the saved file
  shows what Summ held. It needs `login --write`. Afterwards, upload the
  files, then pull and plan again.
- `prune` removes the snapshots older than `--older-than` days (default
  30; never the latest) and the stored actions only those list, once they
  are committed (keep the state dir in git; git keeps the removed files). If
  any is not committed, it removes nothing and lists them.
- `tools` lists the server's tools.

Each command may call only the tools it needs; `login` and `pull` use read
tools only, `plan` none, `apply` also `edit_transaction` and
`bulk_edit_transactions`. Requests are spaced 400 ms apart.

## State dir

Your private folder, never a public repo: it holds your token and a copy of
your transactions. Settings are in `<state dir>/summ-sync.json`, all
optional:

```json
{
  "managedChains": ["THOR", "MAYA"],
  "managedSources": ["thorchain"],
  "filedBefore": "2024-01-01",
  "timezone": "Europe/London"
}
```

- `managedChains`: chains whose CSV files you upload; the sync manages
  their rows. Rows of other chains only correct Summ's own import of those
  wallets. Choose per chain by which gives the better rows, never both for
  one wallet (its rows would count twice).
- `managedSources`: Summ's source names of the uploaded rows (see
  `get_filter_options`); `pull` saves full detail for their actions.
- `filedBefore`: rows before this date are in filed years; changing them is
  an amendment.
- `timezone`: your Summ account's timezone (default `UTC`), for the days of
  the run's periods and of `filedBefore`.

## Tests

    cd packages/summ-sync && npm run typecheck && npm test
