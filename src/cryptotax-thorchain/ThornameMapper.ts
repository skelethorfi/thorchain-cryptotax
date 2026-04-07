import {Action, Coin, Transaction} from '@xchainjs/xchain-midgard';
import {CryptoTaxTransaction, CryptoTaxTransactionType} from '../cryptotax';
import {parseMidgardDate} from './MidgardUtils';
import {baseToAssetAmountString} from '../utils/Amount';
import {Mapper} from './Mapper';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";

// 0.02 RUNE
const DEFAULT_RUNE_GAS = '2000000';

// Assumes default gas fee. One sample from thornode had no gas, but not sure if that's a data quality issue.
// Could update this to get the gas from the thornode tx.
export class ThornameMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {
        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const input: Transaction = action.in[0];
        const thornameMetadata = (action as any).metadata?.thorname;
        const walletAddress = input.address || thornameMetadata?.owner || thornameMetadata?.address || '';
        const txId = input.txID ?? '';
        const numCoins = input.coins.length;

        if (numCoins === 0) {
            transactions.push({
                walletExchange: walletAddress,
                timestamp,
                type: CryptoTaxTransactionType.Expense,
                baseCurrency: '',
                baseAmount: '',
                feeCurrency: 'RUNE',
                feeAmount: baseToAssetAmountString(DEFAULT_RUNE_GAS),
                from: walletAddress,
                to: 'thorchain',
                blockchain: 'THOR',
                id: `${idPrefix}.thorname`,
                description: `1/1 - Update Thorname; ${txId}`,
            });
        } else {
            const inputCoin: Coin = input.coins[0];
            const amount = baseToAssetAmountString(inputCoin.amount);

            transactions.push({
                walletExchange: walletAddress,
                timestamp,
                type: CryptoTaxTransactionType.Expense,
                baseCurrency: 'RUNE',
                baseAmount: amount,
                feeCurrency: 'RUNE',
                feeAmount: baseToAssetAmountString(DEFAULT_RUNE_GAS),
                from: walletAddress,
                to: 'thorchain',
                blockchain: 'THOR',
                id: `${idPrefix}.thorname`,
                description: `1/1 - Register/fund Thorname with ${amount} RUNE; ${txId}`,
            });
        }

        return transactions;
    }
}
