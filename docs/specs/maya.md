# Maya Protocol

## Summary

Maya Protocol is a THORChain fork with its own Midgard
(`https://midgard.mayachain.info`), native asset CACAO and pools that include
`THOR.RUNE`. Maya's Midgard returns actions in the same format as THORChain's,
so swaps and liquidity actions on Maya are exported by the same mappers, with a
protocol setting that supplies the differences.

This spec covers swaps, add liquidity, withdraw liquidity and refunds on Maya.
It does not cover MAYA token sends or Maya bonding.

## Enabling Maya

Maya is off by default, so existing configs export exactly what they did before.
Enable it per config:

```toml
protocols = ["thorchain", "maya"]
```

When enabled, every wallet in the config is also queried on Maya's Midgard, not
only `maya1` wallets: swaps and liquidity adds are often started from a `thor1`,
`0x` or other address. Maya responses are cached in `<cachePath>/maya-midgard/`.

## Protocol differences

| | THORChain | Maya |
| --- | --- | --- |
| Native asset | `THOR.RUNE` | `MAYA.CACAO` |
| Native asset decimals | 8 | **10** |
| Other asset decimals | 8 | 8, except the MAYA token (`MAYA.MAYA` / `MAYA`), which is **4** |
| Counterparty in `from` / `to` | `thorchain` | `mayaprotocol` |
| Blockchain value for the native chain | `THORChain` | `MayaProtocol` (to be confirmed in Summ; see below) |
| LP token | `ThorLP.<pool>` | `MayaLP.<pool>` |
| Native address prefix | `thor1` | `maya1` |
| Default inbound gas when node data is missing | 0.02 RUNE (see `fees.md`) | 0.2 CACAO for CACAO inputs (Mayanode `NativeTransactionFee`, `2000000000` in constants and mimir on 2026-10-01; assumed unchanged historically); 0.02 RUNE for RUNE inputs (sent on THORChain); none for other inputs, as Maya node data is not fetched |

Decimals were checked on 2026-10-01 against live pool depths: Midgard's
`assetPriceUSD` only matches `cacaoDepth / assetDepth` when CACAO is read as
1e10 and pool assets as 1e8, and the MAYA pool only matches when MAYA is read
as 1e4.

The blockchain value: Summ ignores a blockchain it does not recognise, so a
wrong value is harmless but loses the hint. `MayaProtocol` is kept in one place
(`src/protocols`) so it can be corrected once confirmed with a manual CSV
upload to Summ.

## Required behaviour

### Swaps

As THORChain swaps (`BridgeTradeOut` from the sender, `BridgeTradeIn` to the
memo's destination), using the Maya counterparty and decimals. Row ids use the
protocol id (`<date>.maya.bridge-trade-out`).

**Affiliate fees.** Swaps through an interface with an affiliate can have an
extra output, usually in CACAO, to the affiliate's address. It is not the
user's, so it is ignored: the `BridgeTradeOut` keeps the full input, and the
fee is part of what the input bought.

**Partially filled swaps.** A streaming swap that fills only partly returns the
unfilled part of the input to the sender. Midgard reports this as two actions
with the same txid: a `swap` whose outputs include the returned part (to the
sender, in the input asset), and a `refund` for that part.
That output is netted off the `BridgeTradeOut` amount: the row shows what was
actually swapped, and its description notes the amount returned. For example,
1000 CACAO in, 25 CACAO returned and 200 RUNE out becomes a trade-out of
975 CACAO for 200 RUNE. The `refund` action has no rows: the swap's rows
already account for what was sent and returned (`fees.md`).

### Add liquidity

As THORChain: one `AddLiquidity` row per deposited asset, a
`ReceiveLpToken` row for `MayaLP.<pool>` and the `Spam` price-helper row. With
two assets, the first must be the native asset (CACAO on Maya).

### Withdraw liquidity

As THORChain: `ReturnLpToken`, the `Spam` price-helper row and one
`RemoveLiquidity` row per asset returned, with the native-asset output first.
The dust inbound used to trigger the withdrawal (e.g. 1e-10 CACAO) is ignored,
as on THORChain.

### Refunds

As THORChain (`fees.md` → Refunds), with Maya decimals and `mayaprotocol` as
the counterparty: a `FailedOut` row with the inbound fee, and a `Fee` row for
what Maya kept when less came back than was sent. Refunds still `pending` are
skipped, as on THORChain.

### Blockchain values

As on THORChain, swap rows use the protocol's blockchain name for its native
chain (`MayaProtocol`), while liquidity deposit and withdrawal rows use the
Midgard chain id (`MAYA`, `THOR`, `KUJI`, …).

## Golden cases

Public Maya transactions in `test/cases/maya/`: CACAO → ETH.USDC swap, CACAO →
RUNE and RUNE → KUJI swaps with affiliate outputs, a partially filled BTC →
ETH swap and its refund (which has no rows), a symmetric KUJI add and a symmetric RUNE-pool
withdrawal.

## Not covered yet

- MAYA token transfers (Midgard `send` with asset `MAYA`)
- The 2023 liquidity auction (`donate:` memo): cost base of the position it created
- Fees paid on Maya inbound transactions
