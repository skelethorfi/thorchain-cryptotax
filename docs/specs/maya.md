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
`0x` or other address. Maya responses are cached in `<storePath>/records/maya-midgard/`.

## Protocol differences

| | THORChain | Maya |
| --- | --- | --- |
| Native asset | `THOR.RUNE` | `MAYA.CACAO` |
| Native asset decimals | 8 | **10** |
| Other asset decimals | 8 | 8, except the MAYA token (`MAYA.MAYA` / `MAYA`), which is **4** |
| Counterparty in `from` / `to` | `thorchain` | `mayaprotocol` |
| Blockchain value for the native chain | `THORChain` | `Mayachain` (Summ's name; Summ has no Maya Protocol chain to attach rows to; see below) |
| LP token | `ThorLP.<pool>` | `MayaLP.<pool>` |
| Native address prefix | `thor1` | `maya1` |
| Default inbound gas when node data is missing | 0.02 RUNE (see `fees.md`) | 0.2 CACAO for CACAO inputs (Mayanode `NativeTransactionFee`, `2000000000` in constants and mimir on 2026-10-01; assumed unchanged historically); 0.02 RUNE for RUNE inputs (sent on THORChain); none for other inputs, as Maya node data is not fetched |

Decimals were checked on 2026-10-01 against live pool depths: Midgard's
`assetPriceUSD` only matches `cacaoDepth / assetDepth` when CACAO is read as
1e10 and pool assets as 1e8, and the MAYA pool only matches when MAYA is read
as 1e4.

The blockchain value: Summ lists Maya Protocol as `Mayachain` (integration id
`mayachain`, CSV and API import only). Its blockchains, the chains a row can
be attached to, include `thorchain` and `kujira` but not Maya Protocol, so a
Maya Protocol row gets no chain whatever the column says: a test upload with
`Mayachain`, `mayachain`, `MayaProtocol` and a blank value gave no chain on
any row. Rows are still identified by their import source (Mayachain). The
exporter writes `Mayachain`, Summ's own name, which is the likeliest to match
if Summ adds the chain. It is set in one place (`src/domain/Protocol.ts`).

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

### Liquidity auction (2023)

Maya opened its `THOR.RUNE` pool with a liquidity auction (March to April
2023). A participant sent RUNE on THORChain, by `MsgSend` to Maya's vault
with the memo `+:THOR.RUNE:<maya address>:…`, one or more times. At the end
(2023-04-17) Maya created every participant's LP position in one `donate:`
tx: Maya's Midgard lists one `addLiquidity` per participant (1,444 of them),
with memo `donate:thor.rune`, a CACAO side the auction supplied (carrying the
donate txid) and a RUNE side with **no txid**. Neither Midgard links the
deposits to the add.

**Linking.** A deposit is a successful THORChain `send` from the add's RUNE-side
address whose memo starts with `+:THOR.RUNE:<the add's CACAO-side address>`
(case ignored), before the add. Deposits are attached to the add's bundle as
its `inbounds` and give no send rows. A deposit that was refunded is already
the inbound of its refund (`sends.md`), so it is not attached.

**Rows.** The RUNE left the wallet with each deposit; the position came at the
end, with what the auction added:

| When | Row | Amount |
| --- | --- | --- |
| each deposit | `AddLiquidity` RUNE, with the deposit's 0.02 RUNE fee | the deposit |
| the auction's end | `Income` CACAO, then `AddLiquidity` CACAO | the add's CACAO side |
| the auction's end | `Income` RUNE, then `AddLiquidity` RUNE | the add's RUNE side − the deposits, when positive |
| the auction's end | `ReceiveLpToken` `MayaLP.THOR.RUNE`, and the `Spam` price-helper row | the add's liquidity units |

The CACAO side and the RUNE above the deposits came from the auction, not the
wallet. How to treat them is a tax choice, set by the config key
`mayaLiquidityAuction`:

- `"income"`: they are income at the auction's end, then added to the pool,
  so the position's cost includes them (the `Income` and `AddLiquidity` rows
  above).
- `"deposit"`: no rows for them; the position's cost is the RUNE deposited,
  and any gain shows when the position is withdrawn.

The key has no default: a run that finds an auction position stops, before
writing anything, until it is set, as a default would make a choice worth
an income year's timing for the user. Configs without an auction position
never need it. The rows both choices share (the deposits, the LP token and
the price-helper) have the same IDs under either, so switching changes
exactly the `Income` and `AddLiquidity` rows at the auction's end. When the RUNE
side is **less** than the deposits (an auction withdrawal, or a tier rule),
the run cannot tell what happened to the rest: no RUNE row is added at the
end, and the action gets an enter-by-hand note. An add with no deposits found
is exported as an ordinary add, with a warning.

Golden case: `maya/liquidity-auction` (a public participant).

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

As on THORChain, every row uses the protocol's blockchain name for its native
chain (`Mayachain`, and `THORChain` for RUNE), and Midgard's chain id for
an L1 chain (`KUJI`, `BTC`, …). See `assets.md`.

## Golden cases

Public Maya transactions in `test/cases/maya/`: CACAO → ETH.USDC swap, CACAO →
RUNE and RUNE → KUJI swaps with affiliate outputs, a partially filled BTC →
ETH swap and its refund (which has no rows), a symmetric KUJI add, a liquidity auction position with its deposits, and a symmetric RUNE-pool
withdrawal.

## Not covered yet

- MAYA token transfers (Midgard `send` with asset `MAYA`)
- Fees paid on Maya inbound transactions
