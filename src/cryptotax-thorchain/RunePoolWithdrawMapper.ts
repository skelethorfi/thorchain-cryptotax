import {Action, Coin, Transaction} from '@xchainjs/xchain-midgard';
import {CryptoTaxTransaction, CryptoTaxTransactionType} from '../cryptotax';
import {parseMidgardDate} from './MidgardUtils';
import {baseToAssetAmountString} from '../utils/Amount';
import {Mapper} from './Mapper';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";

export class RunePoolWithdrawMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {
        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();
        const poolName: string = 'RUNEPool';

        const transactions: CryptoTaxTransaction[] = [];

        const output: Transaction = action.out[0];
        const outputCoin: Coin = output.coins[0];
        const amount = baseToAssetAmountString(outputCoin.amount);
        const liquidityUnits: string = baseToAssetAmountString(
            action.metadata.runePoolWithdraw?.units ?? ''
        );
        const txId = output.txID ?? '';

        const lpToken: string = 'ThorLP.THOR.RUNE';

        const date_plus_10 = new Date(date.getTime() + (10 * 1000));
        const timestamp_plus_10: string = date_plus_10.toISOString();

        // Return liquidity units

        transactions.push({
            walletExchange: output.address,
            timestamp,
            type: CryptoTaxTransactionType.ReturnLpToken,
            baseCurrency: lpToken,
            baseAmount: liquidityUnits,
            from: output.address,
            to: 'thorchain',
            blockchain: 'THORChain',
            id: `${idPrefix}.return-lp-token`,
            description: `1/2 - Return LP token to ${poolName}; ${txId}`,
        });

        // Withdraw asset

        transactions.push({
            walletExchange: output.address,
            timestamp: timestamp_plus_10,
            type: CryptoTaxTransactionType.RemoveLiquidity,
            baseCurrency: 'RUNE',
            baseAmount: amount,
            from: 'thorchain',
            to: output.address,
            blockchain: 'THORChain',
            id: `${idPrefix}.remove-liquidity`,
            description: `2/2 - Withdraw ${amount} RUNE from ${poolName}; ${txId}`,
        });

        return transactions;
    }
}
