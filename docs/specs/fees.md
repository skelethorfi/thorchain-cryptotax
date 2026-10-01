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
   has gas: `thornodeTx.tx.gas[0]`, in that gas asset. THORNode is fetched for
   swaps and switches (including loan opens and repayments, which are swaps).
2. **Otherwise, a default for native transactions**:
   - an asset on THORChain (`THOR.*`, e.g. RUNE, TCY, KUJI on THORChain), or a
     synth, trade or secured asset: **0.02 RUNE**, THORChain's native
     transaction fee
   - on Maya, CACAO: **0.2 CACAO** (see `maya.md`)
3. **Otherwise blank.** Gas for L1 inputs (BTC, ETH, tokens, …) is only known
   from THORNode. Those rows are reference rows anyway: Summ takes L1 sends from
   the wallet's own integration, with its real on-chain fee.

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
| Refund | `FailedIn` | inbound fee; the refund's outbound fee shows only as the lower amount returned |
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

### Partially filled swaps

A streaming swap can fill only partly and return the unfilled input to the
sender. That part was never swapped, so it is not a fee: the `BridgeTradeOut`
amount is the input minus what was returned (`maya.md`). The fee is still the
inbound fee.

## Tests

- Unit tests for `getInboundFee` and each mapper's fee, including:
  - THORNode gas is preferred over any default
  - a missing THORNode tx gives the native default, or blank for L1 inputs
  - `networkFees`, `liquidityFee` and affiliate outputs are never used as fees
- Golden cases in `test/cases/` carry the expected fee in each row.
