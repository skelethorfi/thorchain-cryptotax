import {Action, Coin, Transaction} from '@xchainjs/xchain-midgard';
import {CryptoTaxTransaction, CryptoTaxTransactionType} from '../cryptotax';
import {parseMidgardDate, parseMidgardAsset} from './MidgardUtils';
import {baseToAssetAmountString} from '../utils/Amount';
import {Mapper} from './Mapper';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";

// TODO: is midgard the best source for this or is there somewhere else to get cosmwasm transactions?
export class RujiraMergeDepositMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {
        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const input: Transaction = action.in[0];
        const txId = input.txID ?? '';

        // Parse contract funds
        const funds = (action.metadata as any).contract.funds;
        const match = funds.match(/^(\d+)(.+)$/);
        if (!match) {
            throw new Error(`Invalid funds format: ${funds}`);
        }
        const [, amountStr, assetStr] = match;
        const amount = baseToAssetAmountString(amountStr);
        // Convert assetStr from "thor.kuji" to "THOR.KUJI" format
        const formattedAssetStr = assetStr.toUpperCase();
        const { blockchain, currency } = parseMidgardAsset(formattedAssetStr);
        const asset = `${blockchain}.${currency}`;

        transactions.push({
            walletExchange: input.address,
            timestamp,
            type: CryptoTaxTransactionType.StakingDeposit,
            baseCurrency: asset,
            baseAmount: amount,
            from: input.address,
            to: 'thorchain',
            blockchain: 'THORChain',
            id: `${idPrefix}.rujira-merge-deposit`,
            description: `1/1 - wasm-rujira-merge/deposit ${amount} ${asset}; ${txId}`,
        });

        return transactions;
    }
}
