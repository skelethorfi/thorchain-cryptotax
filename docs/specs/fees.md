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
   - swaps and switches (including loan opens and repayments, which are swaps)
     and refunds: the inbound transaction
   - add liquidity and withdraw liquidity: each inbound transaction sent on an
     L1 chain. Ones sent on THORChain use the default below.
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

### Refunds

A refund is two transactions: the wallet sends the inbound and pays its gas,
then THORChain sends the outbound back and pays that gas from its vault. The
wallet is the receiver of the outbound, and a receiver does not pay the
sender's gas, the same as when anyone else sends to the wallet.

- The `FailedIn` row carries the amount sent in and the **inbound** gas.
- The outbound's gas is **never** exported as a fee. THORChain recovers it by
  returning less than was sent in (Midgard `networkFees`), so the wallet
  already bears it as the lower amount received. Exporting it as a fee as
  well would count it twice.

Example (`refund/btc-price-limit`): 0.0120779 BTC sent in with 0.0000166 BTC
gas; 0.01204055 BTC returned. The fee is 0.0000166 BTC. The 0.00003735 BTC
difference is the outbound fee and is not a fee on any row.

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
  - L1 refunds and L1 liquidity deposits use the THORNode gas
    (`refund/btc-price-limit`, `liquidity/add-btc-rune-symmetric`)
  - `networkFees`, `liquidityFee` and affiliate outputs are never used as fees
- Golden cases in `test/cases/` carry the expected fee in each row.
