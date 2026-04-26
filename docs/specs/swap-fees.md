# Swap Fees

## Summary

For THORChain swaps, the exported `feeCurrency` and `feeAmount` on the outgoing swap transaction must represent the wallet-paid gas on the inbound transaction to THORChain.

This spec applies to:

- `src/cryptotax-thorchain/SwapMapper.ts`
- the shared inbound fee helper in `src/cryptotax-thorchain/ThorchainUtils.ts`
- exporter wiring that fetches the related thornode transaction for swap actions

This spec does not change fee behavior for loan, refund, withdraw, or liquidity mappers.

## Motivation

THORChain exposes multiple fee-like values:

- inbound wallet gas paid by the user to submit the transaction
- outbound network fees reported by Midgard
- liquidity fees retained by the protocol
- affiliate amounts represented in outputs

Only the inbound wallet gas should be exported in the CSV fee columns for swap transactions in this repo.

The other fee-like values are already reflected in the net swap amounts or represent protocol-retained amounts rather than additional wallet-paid gas.

## Required Behavior

### Exported swap fee

For a swap:

- `BridgeTradeOut.feeCurrency` and `BridgeTradeOut.feeAmount` must come from the matching thornode inbound transaction gas when available
- `BridgeTradeIn` must not carry a fee

### Thornode source

The fee must be read from:

- thornode transaction selected by matching inbound `txId`
- `thornodeTx.tx.gas[0]`

When thornode gas exists:

- `feeCurrency` must use the gas asset currency
- `feeAmount` must use the gas asset amount converted with existing amount helpers

### Fallback behavior when thornode gas is missing

If thornode gas is unavailable, use default `0.02 RUNE` only when the inbound asset is one of:

- `THOR.RUNE`
- `AssetType.SYNTH`
- `AssetType.TRADE`
- `AssetType.SECURED`

If thornode gas is unavailable and the inbound asset is not in that set:

- do not infer a fee from Midgard `networkFees`
- leave `feeCurrency` and `feeAmount` blank

### Token assets

`AssetType.TOKEN` must not imply THOR-side RUNE gas fallback.

Example:

- inbound `ETH.USDC-...`
- missing thornode gas

Expected result:

- no exported fee

Not:

- `RUNE 0.02`

## Explicit Non-Goals

The following must not be exported into the swap fee columns in this phase:

- `action.metadata.swap.networkFees`
- `action.metadata.swap.liquidityFee`
- affiliate output amounts

These values may still matter elsewhere, but they are not the swap CSV fee for this mapper.

## Exporter Requirements

For normal swap actions, the exporter must fetch the related thornode transaction so the mapper can read inbound gas.

This requirement also continues to apply to switch actions.

## Acceptance Tests

The implementation must preserve these scenarios:

1. Non-THOR native inbound swap with thornode gas:
   exported fee equals inbound thornode gas, not Midgard `networkFees`

2. Non-THOR native inbound swap without thornode gas:
   exported fee is blank

3. THOR native inbound swap without thornode gas:
   exported fee falls back to `0.02 RUNE`

4. Synth inbound swap without thornode gas:
   exported fee falls back to `0.02 RUNE`

5. Trade inbound swap without thornode gas:
   exported fee falls back to `0.02 RUNE`

6. Token inbound swap without thornode gas:
   exported fee is blank

7. Switch mappings continue to use the same inbound gas helper and preserve existing fee behavior

## Future Work

Likely next tranche:

- `LoanOpenMapper`
- `LoanRepaymentMapper`
- `RefundMapper`

Those mappers still need a separate fee policy decision because they currently mix protocol-retained amounts and wallet-paid gas into a single fee column.
