import {Action, Coin, Transaction} from '@xchainjs/xchain-midgard';
import {CryptoTaxTransaction, CryptoTaxTransactionType} from '../cryptotax';
import {parseMidgardDate} from './MidgardUtils';
import {baseToAssetAmountString} from '../utils/Amount';
import {Mapper} from './Mapper';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";

export class TcyUnstakeMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {
        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const output: Transaction = action.out[0];
        const outputCoin: Coin = output.coins[0];
        const amount = baseToAssetAmountString(outputCoin.amount);
        const txId = output.txID ?? '';

        transactions.push({
            walletExchange: output.address,
            timestamp,
            type: CryptoTaxTransactionType.StakingWithdrawal,
            baseCurrency: 'TCY',
            baseAmount: amount,
            from: 'thorchain',
            to: output.address,
            blockchain: 'THORChain',
            id: `${idPrefix}.tcy_unstake`,
            description: `1/1 - Unstake ${amount} TCY; ${txId}`,
        });

        return transactions;
    }
}
