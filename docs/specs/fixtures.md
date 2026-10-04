# Test fixtures (golden cases)

## Summary

Every supported transaction type is covered by golden cases: real Midgard,
Viewblock or TCY distribution data, with the CSV rows the exporter must produce.
Cases must never contain a contributor's own wallets or transactions.

## Layout

```
test/cases/<group>/<name>/
  input.json      raw source data
  expected.yaml   reviewed CSV rows
```

`input.json`:

| Field | Meaning |
| --- | --- |
| `description` | What the case covers |
| `source` | `midgard`, `viewblock` or `tcy` |
| `wallet` | The wallet being exported (used by the viewblock and tcy mappers) |
| `data` | The Midgard action, Viewblock tx or TCY distribution item, as returned by the API |
| `thornodeTxs` | Optional related THORNode `tx/status` responses (swaps and switches) |

`test/GoldenCases.test.ts` runs every case through `TaxEvent`, the same path the
exporter uses, and compares the result with `expected.yaml`. A case without
`expected.yaml` is reported as a todo: its input is in, but its mapper or review is
not.

## Required behaviour

### Source of a case

1. Prefer a public transaction from someone else with the same shape as the
   transaction being supported. The shape is the action type, its subtype
   (swap `txType` or contract `contractType`), status, input and output assets,
   and contract funds denoms.
2. Only if no such transaction exists, anonymise one: replace every address and
   txid with a placeholder, scale every amount by one factor, and shift every
   date by one offset. Amounts and times also have to change, because an
   amount plus a timestamp can identify a transaction on-chain.

### Expected output

`expected.yaml` is written only after a person has checked the rows against the
spec for that transaction type. Saving the mapper's current output without
review would turn a bug into the expected result.

`expected.yaml` holds one YAML document per CSV row, separated by `---`, in
output order. A case that produces no rows contains only `[]`.

YAML is used so the rows are easy to review and can carry `#` comments
explaining why a value is what it is. Amounts and other number-like strings
must stay quoted (`"0.02"`), because the exporter outputs strings; `show --write`
quotes them automatically, and an unquoted number fails the test rather than
passing silently.

### Private data

Keep your own configs, caches and outputs in a folder outside the repo, and set
`TCT_PRIVATE_DIR` to it. The fixture tool then refuses to write a case
containing any address from that folder's `*.toml` configs, any 64-hex txid
found in it, or any entry in its `private-denylist.txt`. It prints only an
8-character prefix of each match.

Without `TCT_PRIVATE_DIR` there is nothing to check against, so the tool
warns, and `fetch` needs an explicit `--out` file.

## Workflow

```
npm run fixture -- fetch <txid>                       # saves to $TCT_PRIVATE_DIR/fixtures (or --out)
npm run fixture -- similar <private input.json>       # public txs of the same shape
npm run fixture -- add <public txid> <group/name>     # writes test/cases/<group/name>/input.json
npm run fixture -- anonymise <input.json> <group/name>  # fallback
npm run fixture -- show test/cases/<group/name>       # print rows; add --write after review
```

Notes:
- Midgard contract actions carry their amounts in `metadata.contract.funds`, not in `coins`.
- `similar` pages back by block `height` from the original transaction, because
  `timestamp` queries time out on the Liquify gateway.
