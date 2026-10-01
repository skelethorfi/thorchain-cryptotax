import {
    Action,
    Coin,
    RefundMetadata,
    Transaction,
} from '@xchainjs/xchain-midgard';
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
import { Protocol, THORCHAIN } from '../protocols/Protocol';

export class RefundMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = [], protocol: Protocol = THORCHAIN): CryptoTaxTransaction[] {
        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();

        const refundMetadata: RefundMetadata = action.metadata.refund as any;

        const transactions: CryptoTaxTransaction[] = [];

        const input: Transaction = action.in[0];
        const inputCoin: Coin = input.coins[0];
        const { blockchain: inputBlockchain, currency: inputCurrency } =
            parseMidgardAsset(inputCoin.asset);
        // The fee is the gas paid to send the refunded tx in (docs/specs/fees.md); the refund's own
        // outbound fee only shows as the lower amount returned
        const { feeCurrency, feeAmount } = getInboundFee(input.txID ?? '', thornodeTxs, inputCoin.asset, protocol);
        const txId = input.txID ?? '';
        const reason = (refundMetadata.reason ?? '').replace(/[\n\t]/g, ' ').trim();

        transactions.push({
            walletExchange: input.address,
            timestamp,
            type: CryptoTaxTransactionType.FailedIn,
            baseCurrency: inputCurrency,
            baseAmount: baseToAssetAmountString(inputCoin.amount, protocol.decimals(inputCoin.asset)),
            feeCurrency,
            feeAmount,
            from: input.address,
            blockchain: formatBlockchainForOutput(inputBlockchain),
            id: `${idPrefix}.refund`,
            description: `refund (${txId}): ${reason}`,
        });

        return transactions;
    }
}
