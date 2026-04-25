import {Action, BondMetadata, Coin, Transaction} from '@xchainjs/xchain-midgard';
import {CryptoTaxTransaction, CryptoTaxTransactionType,} from '../cryptotax';
import {parseMidgardDate,} from './MidgardUtils';
import {baseToAssetAmountString} from '../utils/Amount';
import {Mapper} from './Mapper';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {getDefaultRuneGas} from './ThorchainUtils';

export class UnbondMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {
        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const input: Transaction = action.in[0];
        const output: Transaction = action.out[0];
        const outputCoin: Coin = output.coins[0];
        const amount = baseToAssetAmountString(outputCoin.amount);
        const txId = input.txID ?? '';

        const bondMetadata: BondMetadata = action.metadata.bond as BondMetadata;
        const nodeAddress: string = bondMetadata.nodeAddress;

        transactions.push({
            walletExchange: input.address,
            timestamp,
            type: CryptoTaxTransactionType.StakingWithdrawal,
            baseCurrency: 'RUNE',
            baseAmount: amount,
            feeCurrency: 'RUNE',
            feeAmount: baseToAssetAmountString(getDefaultRuneGas()),
            from: 'thorchain',
            to: input.address,
            blockchain: 'THOR',
            id: `${idPrefix}.unbond`,
            description: `1/1 - Unbond ${amount} RUNE from ${nodeAddress}; ${txId}`,
        });

        return transactions;
    }
}
