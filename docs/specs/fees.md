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
   - refunds: the inbound transaction, only to see what the wallet sent (see
     Refunds of an affiliate's cut). A refund's fee does not use it.
2. **Otherwise, a default for native transactions**:
   - an asset on THORChain (`THOR.*`, e.g. RUNE, TCY, KUJI on THORChain), or a
     synth, trade or secured asset: **0.02 RUNE**, THORChain's native
     transaction fee
   - on Maya, CACAO: **0.2 CACAO** (see `maya.md`)
3. **Otherwise blank.** Gas for L1 inputs (BTC, ETH, tokens, …) is only known
   from THORNode, so an L1 row is blank only when THORNode has no record of the
   inbound transaction, or on Maya, where THORNode is not queried.

Never use Midgard `networkFees` (outbound), `liquidityFee`, `affiliateFee` or
affiliate outputs as a fee. The one exception is refunds (see Refunds).

The fee goes on the row for the wallet that paid it: the row for the inbound
transaction. Rows for what comes out have no fee.

## Per action

| Action | Row with the fee | Fee |
| --- | --- | --- |
| Swap | `BridgeTradeOut` | inbound fee |
| Switch | `BridgeOut` | inbound fee |
| Loan open | `CollateralDeposit` | inbound fee; the `Loan` row has none |
| Loan repayment | `LoanRepayment` | inbound fee; the `CollateralWithdrawal` row has none |
| Refund | `FailedIn` | **exception:** the outbound network fee, not the inbound fee (see Refunds; open question) |
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
| Outbound: THORChain returns it | `out[0]` (amount; on an L1, its own txid on the original chain) | `out_txs` (amount, and the gas the vault paid) |
| What THORChain kept | `metadata.refund.networkFees` | — |

On an L1 the outbound is a real transaction on the original chain back to the
wallet, so the wallet's own import in Summ will also show it, as a receive.
On THORChain the outbound has no txid of its own.

**What is exported.** The exporter collapses the two into **one** `FailedIn`
row and does not export the outbound. This is the exporter's choice, not the
shape of the source data. The type's description
(`CryptoTaxTransactionType.FailedIn`) says a failed transaction is ignored for
tax and balance calculations, with only its fee accounted for. If Summ does
that, the row's amount is informational and its fee is the only part that
counts; this has not been checked in Summ.

**Current behaviour** (unchanged from before the one fee rule): the row
carries the amount sent in, and its fee is the **outbound network fee** in
the refunded asset when Midgard lists one (a partial fill also lists the fee
for the swap's other output), otherwise the first network fee, otherwise
blank. The inbound gas is not exported.

| Case | Sent in | Inbound gas | Returned | Row's fee today |
| --- | --- | --- | --- | --- |
| L1, `refund/btc-price-limit` | 0.0120779 BTC | 0.0000166 BTC | 0.01204055 BTC | 0.00003735 BTC (outbound fee) |
| THORChain, `refund/rune-price-limit` | 1840.58501519 RUNE | 0.02 RUNE (native fee; THORNode lists no gas) | 1840.58501519 RUNE | blank (Midgard lists no network fee) |

**Open question: how should a refund be classified in Summ, and with which
fee?** Leaning towards the **inbound gas** as the `FailedIn` fee: the row
represents the transaction the wallet sent in, and that gas is what the
wallet paid to send it. To settle with a real refund in Summ:

- **THORChain refund.** This CSV is the only source for a `thor` wallet. Today
  the 0.02 RUNE paid to send the inbound is exported nowhere (the RUNE case
  above has no fee at all), so the wallet's balance would be out by it.
- **L1 refund.** The wallet's own import shows the send (with its gas) and the
  smaller receive on the original chain. Does the `FailedIn` row's fee then
  count the outbound fee, or the inbound gas, a second time? Should the row be
  on the L1 wallet at all?
- **The outbound.** Should it be its own row (e.g. a `FailedIn` for the send
  and a receive for the return), instead of being collapsed? The outbound fee
  is not gas the wallet paid: the wallet is the receiver, and the fee shows as
  the lower amount returned.
- **Old L1 refunds.** THORNode has no inbound gas for some 2022–2023 refunds,
  so the inbound-gas rule would leave those blank.

The behaviour is left as it is until that check is done.

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
