import { Action, Coin, Transaction } from '@xchainjs/xchain-midgard';
import {
    CryptoTaxTransaction,
    CryptoTaxTransactionType,
} from '../cryptotax';
import {
    parseMidgardAsset,
    parseMidgardDate,
} from './MidgardUtils';
import { baseToAssetAmountString } from '../utils/Amount';
import { Mapper } from './Mapper';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import { formatBlockchainForOutput, getInboundFee } from './ThorchainUtils';

// Switch is used to migrate an asset from one chain to another.
// e.g. BNB.RUNE to THOR.RUNE, or GAIA.KUJI to THOR.KUJI
//
// Asset migration generally has some time based decay, so the output amount may be less than the input amount.
//
// This will be converted to 2 transactions, BridgeOut and BridgeIn, as it is crossing from one chain to another (e.g. Binance to THORChain) and retaining the
// same asset (and same cost basis). https://help.cryptotaxcalculator.io/en/articles/6268264-bridging-transactions
//
// Both transactions are created here as we have the details from both chains from the Midgard API.
// The external transaction will be a send to THORChain with the memo "switch:{to_thorchain_address}".
export class SwitchMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {
        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();

        // Add some time to the second transaction so it is linked correctly in CTC as it needs to occur after the first.
        // Not sure if this is still required. If so, it could probably just be milliseconds instead.
        const date_plus_10 = new Date(date.getTime() + (10 * 1000));
        const timestamp_plus_10: string = date_plus_10.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const input: Transaction = action.in[0];
        const inputCoin: Coin = input.coins[0];
        const { blockchain: inputBlockchain, currency: inputCurrency } =
            parseMidgardAsset(inputCoin.asset);

        const txId = input.txID ?? '';

        const output: Transaction = action.out[0];
        const outputCoin: Coin = output.coins[0];
        const { blockchain: outputBlockchain, currency: outputCurrency } =
            parseMidgardAsset(outputCoin.asset);

        const { feeCurrency, feeAmount } = getInboundFee(txId, thornodeTxs, inputCoin.asset);

        // Send input asset

        transactions.push({
            walletExchange: input.address,
            timestamp,
            type: CryptoTaxTransactionType.BridgeOut,
            baseCurrency: inputCurrency,
            baseAmount: baseToAssetAmountString(inputCoin.amount),
            feeCurrency,
            feeAmount,
            from: input.address,
            to: output.address,
            blockchain: formatBlockchainForOutput(inputBlockchain),
            id: `${idPrefix}.bridge-out`,
            description: `1/2 - Switch ${inputBlockchain}.${inputCurrency} to ${outputBlockchain}.${outputCurrency} (send ${inputBlockchain}.${inputCurrency}); ${txId}`,
        });

        // Receive output asset

        transactions.push({
            walletExchange: output.address,
            timestamp: timestamp_plus_10,
            type: CryptoTaxTransactionType.BridgeIn,
            baseCurrency: outputCurrency,
            baseAmount: baseToAssetAmountString(outputCoin.amount),
            from: input.address,
            to: output.address,
            blockchain: formatBlockchainForOutput(outputBlockchain),
            id: `${idPrefix}.bridge-in`,
            description: `2/2 - Switch ${inputBlockchain}.${inputCurrency} to ${outputBlockchain}.${outputCurrency} (receive ${outputBlockchain}.${outputCurrency}); ${txId}`,
        });

        return transactions;
    }
}
