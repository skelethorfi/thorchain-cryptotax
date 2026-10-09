# summ-sync

Keeps [Summ](https://summ.com) matching a set of Summ CSV files, like
Terraform: pull Summ's state, plan the differences, apply them, pull again.
The design is `docs/specs/summ-sync.md` in this repo.

It is a separate package: it reads files (Summ CSVs with stable `ID`s and a
`row-ids.csv`), not the exporter's code, and needs no runtime dependencies.
It is TypeScript that Node 24 runs directly (type stripping, so only
erasable syntax: no enums or namespaces); `tsc` from the repo root checks it. It talks to Summ only through Summ's MCP server
(`https://mcp.summ.com/mcp`), with your own login.

Status: `login`, `pull` and `plan`. `apply` is next.

## Usage

    node packages/summ-sync/bin/summ-sync.ts login <state dir> [--write]
    node packages/summ-sync/bin/summ-sync.ts pull  <state dir> [<run dir>]
    node packages/summ-sync/bin/summ-sync.ts plan  <state dir> <run dir>
    node packages/summ-sync/bin/summ-sync.ts tools <state dir>

- `login` opens the browser to authorise this tool (scope `mcp:read`, or
  `mcp:read mcp:write` with `--write`) and keeps the token in
  `<state dir>/.auth.json` (mode 600).
- `pull` writes `<state dir>/snapshots/<timestamp>/`: every page of the
  action list (`pages/`), one line per action (`actions.jsonl`), the full
  JSON and change history of each action of a managed source
  (`details/<action id>.json`), and `manifest.json`. Given a run dir, it
  also fetches the detail of each action whose tx hash is a txid of the
  run's categorised rows (chains not in `managedChains`).
- `plan` compares the run's period wallet files with the latest snapshot
  and writes `<state dir>/plans/<timestamp>/`: `plan.json`, `plan.md` and
  `upload/` (the rows Summ lacks, per file). It calls nothing. It adds the
  legs it adopted (old `<file>:<n>` IDs) to `adopted.csv`, and the values
  you changed in Summ to `overrides.json`, where they win over the run until
  you delete them.
- `tools` lists the server's tools.

Each command may call only the tools it needs; `login` and `pull` use read
tools only, `plan` none. Requests are spaced 400 ms apart.

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
