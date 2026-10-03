# Rujira

Rujira is THORChain's app layer: CosmWasm contracts on THORChain. A call is a
`MsgExecuteContract` signed by a THORChain wallet. Midgard reports it as a
`contract` action whose `metadata.contract.contractType` is the contract's
event (e.g. `wasm-rujira-staking/liquid.bond`).

## Data

Midgard reports only the **sent** side: `funds` (e.g. `100000000x/ruji` for 1 RUJI) and
the contract event's attributes. `coins` is empty on `in` and `out`. It does
not say what the wallet received, the gas paid, or the fees taken inside the
contract.

So every contract action is paired with its **Cosmos tx** from THORNode
(`/cosmos/tx/v1beta1/txs/{hash}`), trimmed to the txid, height, result code,
fee and events. The `transfer` events give what the wallet received, and
`auth_info.fee` gives the gas. The exporter caches it under `thornode-cosmos`,
and a golden case carries it as `cosmosTxs`.

Rujira's own GraphQL API (`api.rujira.network/api`) has the current staking
and merge positions and per-account FIN history. It is useful for checking a
run, but it is not a source of rows. The Rujira SDKs (`rujira.js`,
`@vultisig/rujira`) build txs and fetch quotes. They give no history.

## Fee

The fee is the Cosmos tx fee in RUNE (`auth_info.fee`). A wasm call does not
pay THORChain's 0.02 RUNE native fee: it pays gas, which is about 0.00003 RUNE
for a bond and about 0.2 RUNE for a FIN swap. Without a Cosmos tx the fee is
left blank.

Fees taken inside a contract (FIN's taker fee, Levana's trading fees) are
already netted from what the wallet receives. As for swaps (`fees.md`), they
are not exported as fees.

## Rows

| Contract event | Rows | Amounts | Why |
| --- | --- | --- | --- |
| `wasm-rujira-staking/liquid.bond` | one `staking-deposit` of the bonded asset (`RUJI`, `BRUNE`) | `funds` | Staked RUJI held as a receipt token (sRUJI `x/staking-x/ruji`, ybRUNE `x/staking-x/brune`). Treated as staking, like TCY staking, so the cost base stays with the asset; the receipt token is not exported |
| `wasm-rujira-staking/account.bond` | one `staking-deposit` | `funds` | The same without a receipt token |
| `wasm-rujira-fin/trade` (a FIN market swap) | `bridge-trade-out` + `bridge-trade-in`, as for a THORChain swap | sent: `funds`; received: the `transfer` to the wallet in the Cosmos tx | A trade: one asset disposed of for another |
| `wasm-rujira-merge/deposit` | `bridge-trade-out` of `KUJI` and `bridge-trade-in` of the merge position `RujiraMerge.THOR.KUJI` | sent: `funds`; position: the `shares` attribute | Merging is one-way: the KUJI is gone at the deposit, and only RUJI can come out. The position carries the cost |
| `wasm-rujira-merge/withdraw` | `bridge-trade-out` of `RujiraMerge.THOR.KUJI` and `bridge-trade-in` of `RUJI` | shares: `shares`; RUJI: `amount` | The position is disposed of for RUJI |
| Levana perps (`wasm-crank-fee` with `levana_protocol: perps`) | none | – | Levana is discontinued. A position is entered by hand (see below) |

The position token is `RujiraMerge.<chain>.<asset>` of the merged asset (one
per merge pool), the same shape as `ThorLP.BTC.BTC`. The asset names follow
`assets.md`: `x/ruji` → `RUJI`, `x/brune` → `BRUNE`,
`thor.kuji` → `KUJI` (the THORChain KUJI that a KUJI switch bridges in).

### Merge

Before October 2026 a merge deposit was exported as a `staking-deposit` of
`THOR.KUJI`. That name does not match the `KUJI` that the switch bridges in,
and with no position, the withdraw had nowhere to take the cost from. Years
filed with the old rows need an amendment.

### Levana

A Levana position closes in a crank tx that the wallet did not sign, so it is
not in Midgard. It is not worth a fetch: the protocol is discontinued. Enter
the open and the close by hand in Summ (`open-position` and `close-position`),
using the `wasm-position-close` event on THORNode for the collateral, PnL and
fees.

## Open

- **Staking yield.** A liquid bond's yield builds up in the receipt token's
  redemption rate and comes out on `liquid.unbond` as more of the asset than
  was bonded. An account bond's revenue is paid when claimed. Neither the
  unbond nor the claim is mapped yet, and how Summ treats a
  `staking-withdrawal` larger than the deposit is unverified (`savers.md` has
  the same question).
- **Liquid bond as staking.** The ATO treats wrapping into a separate token as
  a CGT event (C2). sRUJI and ybRUNE are separate, transferable tokens. Staking
  is the current choice, pending advice.

## Golden cases

`rujira/` in `test/cases`, from public transactions.
