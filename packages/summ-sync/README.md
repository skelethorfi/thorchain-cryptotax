# summ-sync

Keeps [Summ](https://summ.com) matching a set of Summ CSV files, like
Terraform: pull Summ's state, plan the differences, apply them, pull again.
The design is `docs/specs/summ-sync.md` in this repo.

It is a separate package: it reads files (Summ CSVs with stable `ID`s and a
`row-ids.csv`), not the exporter's code, and needs no dependencies (Node 24
built-ins only). It talks to Summ only through Summ's MCP server
(`https://mcp.summ.com/mcp`), with your own login.

Status: `login` and `pull`. `plan` and `apply` are next.

## Usage

    node packages/summ-sync/bin/summ-sync.mjs login <state dir> [--write]
    node packages/summ-sync/bin/summ-sync.mjs pull  <state dir>
    node packages/summ-sync/bin/summ-sync.mjs tools <state dir>

- `login` opens the browser to authorise this tool (scope `mcp:read`, or
  `mcp:read mcp:write` with `--write`) and keeps the token in
  `<state dir>/.auth.json` (mode 600).
- `pull` writes `<state dir>/snapshots/<timestamp>/`: every page of the
  action list (`pages/`), one line per action (`actions.jsonl`), the full
  JSON and change history of each action of a managed source
  (`details/<action id>.json`), and `manifest.json`.
- `tools` lists the server's tools.

Each command may call only the tools it needs; `login` and `pull` use read
tools only. Requests are spaced 400 ms apart.

## State dir

Your private folder, never a public repo: it holds your token and a copy of
your transactions. Settings are in `<state dir>/summ-sync.json`, all
optional:

```json
{
  "managedChains": ["THOR", "MAYA"],
  "managedSources": ["thorchain"],
  "filedBefore": "2024-01-01"
}
```

- `managedChains`: chains whose CSV files you upload; the sync manages
  their rows. Rows of other chains only correct Summ's own imports.
- `managedSources`: Summ's source names of the uploaded rows (see
  `get_filter_options`); `pull` saves full detail for their actions.
- `filedBefore`: rows before this date are in filed years; changing them is
  an amendment.

## Tests

    cd packages/summ-sync && npm test
