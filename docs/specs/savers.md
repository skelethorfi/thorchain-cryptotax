# Savers

THORChain Savers (2022 until the ThorFi shutdown in January 2025) took a single
L1 asset, held it as the synth inside the pool, and paid yield in that asset.

## What Midgard reports

- Deposit: an `addLiquidity` action whose pool is the synth (`BTC/BTC`), and
  whose input coin is also reported as the synth, even when the wallet sent
  L1 BTC from a `bc1…` address.
- Withdrawal: a `withdraw` action for the same pool. The request is a dust
  send from the wallet; the output is the L1 asset (`BTC.BTC`).

## Rows

Savers are exported like a liquidity position (README, Savers): an
`AddLiquidity` or `RemoveLiquidity` row for the asset, a `ReceiveLpToken` or
`ReturnLpToken` row for the position, and the `Spam` price-helper row.

| Field | Value | Why |
| --- | --- | --- |
| Asset currency, deposit sent from an L1 wallet | the L1 asset, e.g. `BTC` | the wallet sent real BTC, not the synth (`assets.md`) |
| Asset currency, synth deposited from a THORChain wallet | the synth, e.g. `ThorSynth.BTC.BTC` | the wallet sent the synth |
| Position token | `ThorSavers.<chain>.<asset>`, e.g. `ThorSavers.BTC.BTC`, `ThorSavers.ETH.USDC` | savers units are not pool LP units, so it must differ from `ThorLP.BTC.BTC`; no `/`, which breaks Summ's ledger view; the same `<prefix>.<chain>.<asset>` shape as LP tokens |
| Fee on the deposit | the deposit's inbound fee: L1 gas for an L1 wallet (blank without THORNode gas), 0.02 RUNE for a synth from a THORChain wallet | `fees.md` |

Before October 2026 the token was `ThorLP.BTC/BTC`, a deposit sent from an L1
wallet was exported as `BTC.BTC` (then the synth's name) and, briefly, with a
0.02 RUNE fee.

Maya has the same fields with `MayaSavers` as the prefix.

## Open

- Treatment: liquidity position (today) or staking deposit and withdrawal.
- The ThorFi shutdown: savers positions still open in January 2025 were
  converted to TCY. How the conversion is exported is not specified.

## Golden cases

`liquidity/add-btc-savers` and `liquidity/withdraw-btc-savers` (public
transactions).
