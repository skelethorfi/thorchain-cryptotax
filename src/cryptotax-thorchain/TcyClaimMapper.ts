import {Action, Coin, Transaction} from '@xchainjs/xchain-midgard';
import {getNativeRuneFee} from './ThorchainUtils';
import {CryptoTaxTransaction, CryptoTaxTransactionType} from '../cryptotax';
import {parseMidgardDate} from './MidgardUtils';
import {baseToAssetAmountString} from '../utils/Amount';
import {Mapper} from './Mapper';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";

// This is only mapping the receive tx of TCY.
// Not the signing tx with a dust amount from the original wallet.
export class TcyClaimMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {
        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const input: Transaction = action.in[0];
        const output: Transaction = action.out[0];
        const outputCoin: Coin = output.coins[0];
        const amount = baseToAssetAmountString(outputCoin.amount);
        const txId = output.txID ?? '';

        transactions.push({
            walletExchange: output.address,
            timestamp,
            type: CryptoTaxTransactionType.Receive,
            baseCurrency: 'TCY',
            baseAmount: amount,
            // Fee only when the claim was sent from this THORChain wallet; otherwise it was paid on another chain
            ...(input.address === output.address ? getNativeRuneFee() : {}),
            from: 'thorchain',
            to: output.address,
            blockchain: 'THORChain',
            id: `${idPrefix}.tcy_claim`,
            description: `1/1 - Claim ${amount} TCY for address ${input.address}; ${txId}`,
        });

        return transactions;
    }
}
