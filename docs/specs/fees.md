# Fees

## Summary

Every exported row follows one rule:

- **Amount** is the amount sent in (or received), as the wallet saw it.
- **Fee** is the gas the wallet paid to send that transaction in, and nothing else.

THORChain and Maya deduct other fees (liquidity, affiliate, outbound network,
slip) from the inbound amount before paying out. They are already reflected in
what comes out, so they are not exported as fees. Listing them as fees as well
would count them twice, and the wallet balances in Summ would not add up.

From the earlier restructure (fetch-tx), which follows the same rule:

> So if we have a 100 RUNE input to BTC, there would be 0.02 RUNE gas on the
> input. Meaning, it is a decrease of 100.02 RUNE from the source wallet. There
> are liquidity and affiliate fees applied, but these are subtracted from the
> inbound amount and you get what is left after the fees are applied in the
> output. Therefore, we don't need to export these fees.

## The inbound fee

`getInboundFee` (`src/cryptotax-thorchain/ThorchainUtils.ts`) gives the fee
for an inbound transaction:

1. **THORNode gas**, when the matching THORNode transaction (by inbound txid)
   has gas: `thornodeTx.tx.gas[0]`, in that gas asset. THORNode is fetched
   (`getThornodeTxIds`, `src/thorchain-exporter/Exporter.ts`) for:
   - swaps and switches (including loan opens and repayments, which are swaps):
     the inbound transaction
   - add liquidity and withdraw liquidity: each inbound transaction sent on an
     L1 chain. Ones sent on THORChain use the default below.
   - refunds: the inbound transaction, for its gas and to see what the wallet
     sent (see Refunds of an affiliate's cut).
2. **Otherwise, a default for native transactions**:
   - an asset on THORChain (`THOR.*`, e.g. RUNE, TCY, KUJI on THORChain), or a
     synth, trade or secured asset: **0.02 RUNE**, THORChain's native
     transaction fee
   - on Maya, CACAO: **0.2 CACAO** (see `maya.md`)
3. **Otherwise blank.** Gas for L1 inputs (BTC, ETH, tokens, …) is only known
   from THORNode, so an L1 row is blank only when THORNode has no record of the
   inbound transaction, or on Maya, where THORNode is not queried.

Never use Midgard `networkFees` (outbound), `liquidityFee`, `affiliateFee` or
affiliate outputs as a fee.

The fee goes on the row for the wallet that paid it: the row for the inbound
transaction. Rows for what comes out have no fee.

## Per action

| Action | Row with the fee | Fee |
| --- | --- | --- |
| Swap | `BridgeTradeOut` | inbound fee |
| Switch | `BridgeOut` | inbound fee |
| Loan open | `CollateralDeposit` | inbound fee; the `Loan` row has none |
| Loan repayment | `LoanRepayment` | inbound fee; the `CollateralWithdrawal` row has none |
| Refund | `FailedOut` | inbound fee; what the protocol kept is a separate `Fee` row (see Refunds) |
| Add liquidity | each `AddLiquidity` row | inbound fee of that deposit |
| Withdraw liquidity | `ReturnLpToken` | inbound fee of the withdrawal request (e.g. 0.02 RUNE or 0.2 CACAO); `RemoveLiquidity` rows have none |
| RUNEPool deposit | `AddLiquidity` | 0.02 RUNE |
| RUNEPool withdraw | `ReturnLpToken` | 0.02 RUNE |
| TCY stake / unstake | the single row | 0.02 RUNE |
| TCY claim | `Receive` | 0.02 RUNE when the claim was sent from the receiving THORChain wallet; otherwise none (it was paid on another chain) |
| Rujira merge deposit | `StakingDeposit` | 0.02 RUNE |
| Bond, unbond, Thorname | the single row | 0.02 RUNE |
| Send, Arkeo delegation | the send | actual fee from Viewblock |
| TCY distribution | — | none (nothing sent in) |

### Refunds

**What the sources return.** A refund is two transactions, and both Midgard
and THORNode return both:

| | Midgard `refund` action | THORNode tx status |
| --- | --- | --- |
| Inbound: the wallet sends in | `in[0]` (amount, txid) | `tx` (amount, and `gas` the wallet paid on an L1) |
| Outbound: the protocol returns it | `out[0]` (amount; on an L1, its own txid on the original chain) | `out_txs` (amount, and the gas the vault paid) |
| What the protocol kept | `metadata.refund.networkFees` | — |

On an L1 the outbound is a real transaction on the original chain back to the
wallet. On THORChain the outbound has no txid of its own.

**What the wallet loses.** The gas to send the inbound, plus whatever the
protocol kept: the amount sent minus the amount returned. A modern THORChain
refund returns the full amount; an L1 refund returns less, because the
outbound fee is deducted.

**What is exported.** The outbound is not a row.

| Row | Type | Amount | Fee |
| --- | --- | --- | --- |
| The send | `FailedOut`, on the sending wallet, to the protocol | amount sent | inbound fee (the one fee rule) |
| What the protocol kept, only when the amount returned is less than the amount sent | `Fee`, same wallet and time | sent − returned, in the asset sent | none |

- `FailedOut`, not `FailedIn`: the wallet sent this transaction.
- The `Fee` row is separate, not added to the `FailedOut` fee: the gas and the
  asset sent can be different currencies (a token refund pays gas in ETH), and
  the fee column stays the gas the wallet paid, as everywhere else.
- sent − returned comes from the two amounts, not from `networkFees`. Midgard
  can list a network fee that differs from what was actually kept.
- The `Fee` row's description gives the amount returned and, on an L1, the
  txid of the outbound, so the two transactions can be found in a wallet
  import.

| Case | Sent | Inbound gas | Returned | Rows |
| --- | --- | --- | --- | --- |
| L1, `refund/btc-price-limit` | 0.0120779 BTC | 0.0000166 BTC | 0.01204055 BTC | `FailedOut` 0.0120779 BTC, fee 0.0000166 BTC; `Fee` 0.00003735 BTC |
| THORChain, `refund/rune-price-limit` | 1840.58501519 RUNE | 0.02 RUNE (native fee; THORNode lists no gas) | 1840.58501519 RUNE | `FailedOut` 1840.58501519 RUNE, fee 0.02 RUNE |

**Why this shape (checked in Summ, October 2026).**

- Summ ignores the amount of a failed transaction for tax and for the balance,
  and disposes only its fee. So a refund on a THORChain or Maya wallet, where
  this CSV is the only record, needs exactly one `FailedOut` row carrying the
  gas, and nothing for the amount coming back.
- On an L1, a wallet imported into Summ already has both transactions. Summ
  does not pair them: transfer, bridge and cross-chain trade categories were
  tried on a real refund and none grouped the send with the return. The
  treatment that balances is the same shape as these rows: the send as Failed
  Out, the return ignored, and a fee for what was lost. One difference when
  applying it to an imported wallet: on Bitcoin-style chains Summ's import
  holds the gas inside the amount sent, so the fee to add there is this
  `FailedOut` row's fee plus the `Fee` row; on EVM chains the import has the
  gas as a separate fee and only the `Fee` row is added.

**Not exported.**

- A refund Midgard still reports as `pending` (nothing has been returned) is
  skipped by the exporter, as before. If the outbound never happens, the
  whole amount sent is lost and no row records it. Check those by hand.
- A partially filled swap's refund (see Partially filled swaps).
- Old L1 refunds for which THORNode has no record of the inbound: the
  `FailedOut` fee is blank, per the inbound fee rule.

### Refunds of an affiliate's cut

When a swap has an affiliate, THORChain swaps the affiliate's cut to RUNE as a
swap of its own, which carries the user's txid and address. If that swap fails,
Midgard reports a `refund` action whose input is the cut (e.g. secured USDC),
next to the successful swap with the same txid.

No row is exported for it:

- the wallet never sent that amount, and
- no transaction returns it to the wallet. The cut simply stays in the swap's
  single payout, which is the swap output less the outbound fee only, and the
  swap's `BridgeTradeIn` row already carries that full amount.

`RefundMapper` detects it by the THORNode inbound transaction listing a
different asset from the refund's input (`refund/affiliate-fee-swap`). Without
THORNode data the row is kept.

### Partially filled swaps

A streaming swap can fill only partly and return the unfilled input to the
sender. That part was never swapped, so it is not a fee: the `BridgeTradeOut`
amount is the input minus what was returned (`maya.md`). The fee is still the
inbound fee.

Midgard also reports a `refund` action for the unfilled part, with the same
txid, whose outputs include the swap's output in another asset. No row is
exported for it: the swap's rows already account for everything sent and
returned, including the outbound fee on the returned part, and its
`BridgeTradeOut` carries the inbound fee.

## Tests

- Unit tests for `getInboundFee` and each mapper's fee, including:
  - THORNode gas is preferred over any default
  - a missing THORNode tx gives the native default, or blank for L1 inputs
  - L1 liquidity deposits use the THORNode gas
    (`liquidity/add-btc-rune-symmetric`)
  - a refund is one `FailedIn` row with the outbound network fee
    (`refund/btc-price-limit`), or no fee when Midgard lists none
    (`refund/rune-price-limit`); the outbound is not exported
  - a refund of an affiliate's cut has no row (`refund/affiliate-fee-swap`)
  - `networkFees` (except for refunds), `liquidityFee` and affiliate outputs are
    never used as fees
- Golden cases in `test/cases/` carry the expected fee in each row.
