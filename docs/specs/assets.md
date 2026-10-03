# Asset names

Midgard writes assets as `CHAIN<separator>ASSET`. The separator tells where
the asset lives:

| Midgard | Kind | Lives on | Exported currency | Blockchain column |
| --- | --- | --- | --- | --- |
| `BTC.BTC` | L1 asset | its own chain (Bitcoin) | `BTC` | `BTC` |
| `THOR.RUNE`, `THOR.RUJI` | native THORChain token | THORChain | `RUNE`, `RUJI` | `THORChain` |
| `BTC/BTC` | synth | THORChain | `ThorSynth.BTC.BTC` | `THORChain` |
| `BTC~BTC` | trade asset | THORChain | `ThorTrade.BTC.BTC` | `THORChain` |
| `BTC-BTC`, `ETH-USDC-0X…` | secured asset | THORChain | `ThorSecured.BTC.BTC`, `ThorSecured.ETH.USDC` | `THORChain` |
| `X/RUJI` | Cosmos denom on THORChain (`x/ruji`), not a synth | THORChain | `RUJI` | `THORChain` |

On Maya the prefix is `Maya` (`MayaSynth.BTC.BTC`, …) and the blockchain is
Maya's.

Why:

- A synth, trade or secured asset is a different holding from the L1 asset it
  represents, held on a different chain. If both export as `BTC`, Summ mixes
  their balances and cost bases, and puts the THORChain holding on the Bitcoin
  chain.
- The prefix says where it lives and what kind it is; `<chain>.<asset>` says
  what it represents. It is the same `<prefix>.<chain>.<asset>` shape as
  liquidity tokens (`ThorLP.BTC.BTC`) and savers tokens (`ThorSavers.BTC.BTC`,
  `savers.md`).
- No `/`: a slash in a currency breaks Summ's ledger view.
- Descriptions keep Midgard's notation (`BTC/BTC`, `BTC~BTC`, `ETH-USDC`).

Summ does not recognise these names, so their value comes from the CSV's
reference price columns where a row has them (swaps carry Midgard's USD
prices).

## History

- Before April 2026 a synth was exported as its ticker (`BTC`).
- April 2026 to October 2026: a synth was `BTC.BTC`, which reads like L1 BTC;
  trade and secured assets were their ticker (`BTC`, `USDC`) with the L1
  chain as the blockchain; `x/ruji` was `X.RUJI`.

A holding open when its name changes splits into two balances in Summ (the
old name goes negative). Check positions open across a re-export.

## Tests

`test/MidgardUtils.assets.test.ts`.
