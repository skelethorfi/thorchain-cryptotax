# Activity

A run turns source data into tax rows in stages:

```
sources ──► raw bundles ──► interpret ──► Activity ──► export ──► files
```

An **activity** records what happened on-chain in one action. "Action"
always means the raw source item (a Midgard action, or one contract event);
"activity" means the interpreted one. An activity can span several on-chain
transactions: a swap's inbound and outbound, a refund's send and return.

An activity says nothing about a tax tool: no Summ types, no row IDs, no
descriptions, and no choice of which file a row goes in. An interpreter makes it from a raw bundle (one
Midgard action with its THORNode and Cosmos txs). An exporter turns it into
rows, applying the tax treatment chosen in the config.

Kept apart this way, each kind of change touches one module:

- a new action type is a new interpreter;
- a change of treatment (savers as staking, secured assets as bridges) is a
  change in the exporter;
- a second output format is a second exporter.

The types are in `src/domain/` (`Activity.ts`, `Asset.ts`, `Amount.ts`,
`Issue.ts`).

## Shape

| Field | Meaning |
| --- | --- |
| `id` | The bundle's store record key, e.g. `midgard/bond.<txid>` or `maya-midgard/swap.<txid>` (`getBundleKey`). An action listed for several wallets is one activity |
| `protocol` | `thorchain` or `maya` |
| `kind` | What happened (see Kinds) |
| `status` | `success`, `pending` or `failed`, as the source reports it. The exporter decides what a pending or failed action gives |
| `time` | When the action happened (Midgard's date) |
| `txids` | `in`: the txids the wallet sent; `out`: the txids the protocol paid out on |
| `memo` | The memo the wallet sent, when there is one |
| `legs` | Every amount that moved into or out of a wallet (see Legs) |
| `prices` | USD prices the source observed at the time, with where each came from (e.g. `midgard:swap.inPriceUSD`) |
| `details` | Strings a kind needs in order to be described, e.g. a bond's `node` |

### Legs

A leg is one amount moving into or out of one wallet:

| Field | Meaning |
| --- | --- |
| `direction` | `out` of or `in` to the wallet, from the wallet's side (as Summ sees it; `fees.md` explains THORChain's opposite words) |
| `wallet` | The wallet's address |
| `asset` | See Assets |
| `amount` | Base units and decimals (see Amounts) |
| `role` | `principal`: what the action is about. `gas`: what the wallet paid to send its transaction (the inbound fee, `fees.md`). `returned`: paid back by the protocol (e.g. a refund). `reward`: income paid to the wallet |
| `basis` | `observed`: a source states this amount. `default`: assumed, e.g. THORChain's 0.02 RUNE native fee when nothing gives the gas |
| `txid` | The on-chain tx the amount moved in, when the source gives it. A `gas` leg follows the leg it paid for, so each deposit keeps its own fee |

Every amount is either observed or assumed, and `basis` says which. A
default is recorded as one, so a report can list the rows that rest on
assumptions.

Legs follow the fee rule in `fees.md`. The protocol's own fees (liquidity,
affiliate, outbound) are not legs: they are already deducted from what comes
out.

### Assets

An asset keeps the source's notation (`BTC.BTC`, `BTC/BTC`, `BTC~BTC`,
`BTC-BTC`, `THOR.RUNE`, `x/ruji`) and its kind:

| Kind | Examples |
| --- | --- |
| `native` | a chain's own coin or a protocol's token: `BTC.BTC`, `THOR.RUNE`, `THOR.TCY`, `MAYA.CACAO`, `x/ruji` |
| `token` | a token on an L1 chain: `ETH.USDC-0X…` |
| `synth`, `trade`, `secured` | held on THORChain or Maya, for an L1 asset: `BTC/BTC`, `BTC~BTC`, `BTC-BTC` |
| `position` | a share of a pool; the notation is the pool, and `position` says which: `lp` (`BTC.BTC`) or `savers` (`BTC/BTC`) |

Naming an asset for a tax tool (`ThorSynth.BTC.BTC`, `ThorLP.BTC.BTC`,
`ThorSavers.BTC.BTC`, the `[assets]` prefixes) is the exporter's job
(`assets.md`, `savers.md`). Because a position is an asset, whether a deposit
into one is a disposal or a move into staking is the exporter's decision
(backlog: savers as staking).

### Amounts

An amount is `{base: bigint, decimals}`, e.g. `{base: 2000000n, decimals: 8}`
is 0.02. It stays exact until a row is written. `formatAmount` gives the same
string the CSV has always had (`0.02`, `1`, `5000`).

## Kinds

`ActivityKind` is a closed union. It grows as each action type is ported, so an
exporter cannot be built until it handles every kind.

| Kind | Port step | Legs | Details |
| --- | --- | --- | --- |
| `bond` | 7 | out: principal RUNE (observed); out: gas 0.02 RUNE (default) | `node` |
| `unbond` | 7 | in: principal RUNE (observed); out: gas 0.02 RUNE (default) | `node` |
| `swap` | 8a | out: principal, the full amount sent (observed); in: returned, the unfilled part of a streaming swap paid back to the sender (observed, when any); in: principal, paid to the memo's destination (observed); out: gas, the inbound fee (`fees.md`: observed from THORNode, else the native fee as a default, else none). Affiliate outputs are not legs. Prices: Midgard's `inPriceUSD` and `outPriceUSD`. A synth swapped from an L1 address (a savers withdrawal's internal leg) gives no activity, only an `ignored` issue | — |
| `refund` | 8a | out: principal, the amount sent (observed); in: returned, what the protocol paid back (observed, when any); out: gas, the inbound fee. The exporter writes the send as a failed-out with the fee, and sent − returned as a separate fee row (`fees.md`). A refund of an affiliate's cut, or of a partially filled swap's unfilled part, gives no activity, only an `ignored` issue | `reason` |
| `lp.add`, `savers.add` | 8b | out: principal per deposit (observed; a savers deposit sent from an L1 wallet is the L1 asset, `savers.md`), each followed by its gas leg; in: principal, the position units to the first depositor's wallet (observed). Two deposits: the native asset first | `pool` |
| `lp.withdraw`, `savers.withdraw` | 8b | in: principal per asset paid out (observed); out: principal, the position units given up (observed), followed by the request's gas leg (the request's own coin, usually dust, is not a leg) | `pool` |

The other kinds are added in later steps:

| Step | Kinds |
| --- | --- |
| 8c | `loan.open`, `loan.repay`, `switch`, `runepool.deposit`, `runepool.withdraw` |
| 8d | `tcy.claim`, `tcy.stake`, `tcy.unstake`, `tcy.distribution`, `thorname` |
| 8e | Rujira (`rujira.stake`, `rujira.fin.trade`, `rujira.merge.deposit`, `rujira.merge.withdraw`); Maya through the same interpreters |

Viewblock sends stay on the old path until Midgard sends replace them
(backlog row 6).

## Example

A bond of 1 RUNE to a node, sent from `thor1-user-wallet-11111`
(`test/cases/bond/bond`):

```yaml
id: midgard/bond.0000…0000
protocol: thorchain
kind: bond
status: success
time: 2020-12-31T13:00:00.000Z
txids: {in: [0000…0000], out: []}
legs:
  - {direction: out, wallet: thor1-user-wallet-11111, asset: THOR.RUNE (native), amount: 1, role: principal, basis: observed}
  - {direction: out, wallet: thor1-user-wallet-11111, asset: THOR.RUNE (native), amount: 0.02, role: gas, basis: default}
prices: []
details: {node: thor1-node-address}
```

The Summ exporter (`src/export/summ/`) turns it into one `staking-deposit`
row of 1 RUNE with a 0.02 RUNE fee: today's row. The interpreter is
`src/interpret/midgard/bond.ts`.

## Not in an activity

- Summ types, the `+10 s` timestamps on receiving legs, the `1/2 -`
  descriptions and the LP price-helper row: these are Summ's format, so the
  Summ exporter adds them.
- Row IDs and file names: the exporter and the file layout produce them.
- The wallet being exported: an activity covers every wallet it touches. The
  exporter puts each leg's rows in its wallet's file.

## Tests

- `test/Domain.test.ts`: `formatAmount` matches the CSV's formatting for every
  decimals value in use, and `toAsset` kinds for each notation in
  `assets.md`.
- Golden cases of ported kinds have a reviewed `activity.yaml` between
  `input.json` and `expected.yaml` (`fixtures.md`), so an interpreter bug and
  an exporter bug fail different checks: the `bond/`, `swap/`, `refund/` and
  `liquidity/` cases and the Maya swaps and liquidity.
