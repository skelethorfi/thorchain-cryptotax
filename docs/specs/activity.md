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
| `id` |
| `protocol` |
| `kind` |
| `status` |
| `time` |
| `txids` |
| `memo` |
| `legs` |
| `prices` |
| `details` |

### Legs

A leg is one amount moving into or out of one wallet:

| Field | Meaning |
| --- | --- |
| `direction` |
| `wallet` |
| `asset` |
| `amount` |
| `role` |
| `basis` |
| `txid` |

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
| `native` |
| `token` |
| `synth`, `trade`, `secured` |
| `position` |

Naming an asset for a tax tool (`ThorSynth.BTC.BTC`, `ThorLP.BTC.BTC`,
`ThorSavers.BTC.BTC`, the `[assets]` prefixes) is the exporter's job
(`assets.md`, `savers.md`). Because a position is an asset, whether a deposit
into one is a disposal or a move into staking is the exporter's decision
(backlog: savers as staking).

### Amounts

An amount is `{base: bigint, decimals}`, e.g. `{base: 2000000n, decimals: 8}`
is 0.02. It stays exact until a row is written. `formatAmount` gives the same
string the CSV has always had (`0.02`, `1`, `5000`).

The decimals are the protocol's, not the asset's own chain's: THORChain
holds every asset at 8 decimals, and Maya at 8 except CACAO (10) and MAYA
(4) (`maya.md`). So an L1 amount that Midgard reports is THORChain's 8-decimal
value, not the chain's exact one. An ETH or ERC-20 amount (18 or 6 decimals
on Ethereum) is cut to 8, and an inbound's gas is THORChain's observation of
it at 8 decimals, which can be one unit above the exact fee. A wallet import of the same L1 tx (Summ's own)
can differ from the CSV in the last decimals; Summ sync treats a difference of
at most one unit at the 8th decimal as equal (`summ-sync.md`). The exact value
is only on the L1 chain; the exporter does not read it.

## Kinds

`ActivityKind` is a closed union, so an exporter cannot be built until it
handles every kind.

| Kind | Legs | Details |
| --- | --- | --- |
| `bond` | out: principal RUNE (observed); out: gas 0.02 RUNE (default) | `node` |
| `unbond` | in: principal RUNE (observed); out: gas 0.02 RUNE (default) | `node` |
| `swap` | out: principal, the full amount sent (observed); in: returned, the unfilled part of a streaming swap paid back to the sender (observed, when any); in: principal, paid to the memo's destination (observed); out: gas, the inbound fee (`fees.md`: observed from THORNode, else the native fee as a default, else none). Affiliate outputs are not legs. Prices: Midgard's `inPriceUSD` and `outPriceUSD`. A synth swapped from an L1 address (a savers withdrawal's internal leg) gives no activity, only an `ignored` issue | — |
| `refund` | out: principal, the amount sent (observed); in: returned, what the protocol paid back (observed, when any); out: gas, the inbound fee. The exporter writes the send as a failed-out with the fee, and sent − returned as a separate fee row (`fees.md`). A refund of an affiliate's cut, or of a partially filled swap's unfilled part, gives no activity, only an `ignored` issue | `reason` |
| `lp.add`, `savers.add` | out: principal per deposit (observed; a savers deposit sent from an L1 wallet is the L1 asset, `savers.md`), each followed by its gas leg; in: principal, the position units to the first depositor's wallet (observed). Two deposits: the native asset first | `pool` |
| `lp.withdraw`, `savers.withdraw` | in: principal per asset paid out (observed); out: principal, the position units given up (observed), followed by the request's gas leg (the request's own coin, usually dust, is not a leg) | `pool` |
| `switch` | out: principal, the asset on its old chain (observed), followed by its gas leg; in: principal, the same asset on THORChain (observed) | — |
| `runepool.deposit`, `runepool.withdraw` | the RUNE sent or received (observed); the RUNEPool units received or given up, a `runepool` position (observed); gas: the native fee (default) | — |
| `loan.open` | out: principal, the collateral sent (observed; when Midgard shows `THOR.TOR`, the THORNode tx's coin), followed by its gas leg; in: principal, the amount borrowed, paid to the memo's destination (observed). `loans.md` says which pending loan opens count | — |
| `loan.repay` | out: principal, the repayment (observed), followed by its gas leg; in: principal, the collateral paid back when the loan closes (observed, one output) | `collateral`: the memo's collateral asset |
| `send` | from the side of the wallet that listed it (`sends.md`): the sender's out: principal, the coin sent (observed), and out: gas, 0.02 RUNE (default); or the receiver's in: principal (observed). Midgard sends, and Viewblock sends from before 2022-04 that Midgard does not list | `from`, `to`; `purpose: delegate-arkeo` for an Arkeo delegation; `failedAction` for a send to itself with an action memo, e.g. `TCY claim` |
| `tcy.claim` | in: principal, the TCY claimed (observed); gas: the native fee (default), only when the claim was sent from the same THORChain wallet | `claimedFor`: the address that held the claim |
| `tcy.stake`, `tcy.unstake` | the TCY sent or received (observed); gas: the native fee (default) | — |
| `tcy.distribution` | in: reward, the RUNE paid to the wallet it was listed for (observed). Price: the RUNE price the TCY API gives (`midgard:tcy.distribution.price`) | — |
| `maya.distribution` | in: reward, the CACAO paid to a MAYA holder at a payout height (observed: Midgard's dividends list, the wallet's balance step, or the block's event; `maya.md`) | `height`; `maya`: the MAYA held, when the balance step gives it |
| `thorname` | out: principal, the RUNE paid to register or renew (observed, when any; an update pays none); gas: the native fee (default). An update with no input address takes the name's owner as the wallet | `name` |
| `rujira.stake` | out: principal, the coin bonded (observed); gas: the wasm call's gas from its Cosmos tx (observed, when any; not the native fee, `rujira.md`) | `bond`: `liquid` or `account`; `shares` for a liquid bond |
| `rujira.fin.trade` | out: principal, the coin sent to FIN (observed); in: returned, any of it sent back (observed); in: principal, the coin received, net of FIN's fee, from the Cosmos tx (observed); gas as above | — |
| `rujira.merge.deposit`, `rujira.merge.withdraw` | the coin merged or the RUJI withdrawn (observed), against shares of the merge pool, a `merge` position (observed); gas as above | — |

Every Midgard action type the exporter maps has a kind. Maya actions go
through the same interpreters with Maya's protocol values (decimals, native
asset and fee, address prefix, chain); only a tx sent on THORChain inside a
Maya action pays THORChain's fee. Maya sends are not mapped yet.

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
- Every reviewed golden case is checked against its `activity.yaml`
  between `input.json` and `expected.yaml` (`fixtures.md`; none means no
  activities), so an interpreter bug and an exporter bug fail different
  checks.
