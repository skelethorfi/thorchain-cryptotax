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
        // THORChain swaps an affiliate's cut of a swap to RUNE as a swap of its own, carrying the user's
        // txid and address. When that fails, Midgard reports a refund of the cut, which the wallet never
        // sent: THORNode shows what the wallet did send, so no row is exported (docs/specs/fees.md).
        const sentCoins = thornodeTxs.find((tx) => tx.tx?.id === input.txID)?.tx?.coins;

        if (sentCoins && !sentCoins.some((coin) => coin.asset.toUpperCase() === inputCoin.asset.toUpperCase())) {
            return transactions;
        }

        // A partially filled swap: Midgard also reports a refund for the unfilled part, whose outputs
        // include the swap's output. The swap action with the same txid already accounts for everything
        // (its trade-out is what was sent less what was returned), so no row is exported here.
        const returned = action.out.flatMap((out) => out.coins);

        if (returned.some((coin) => coin.asset !== inputCoin.asset)) {
            return transactions;
        }

        const decimals = protocol.decimals(inputCoin.asset);
        const txId = input.txID ?? '';
        const reason = (refundMetadata.reason ?? '').replace(/[\n\t]/g, ' ').trim();
        const blockchain = formatBlockchainForOutput(inputBlockchain);
        const sentAmount = baseToAssetAmountString(inputCoin.amount, decimals);

        // Summ ignores the amount of a failed transaction and counts only its fee, so the fee is the gas
        // the wallet paid to send it, like every other row (docs/specs/fees.md).
        transactions.push({
            walletExchange: input.address,
            timestamp,
            type: CryptoTaxTransactionType.FailedOut,
            baseCurrency: inputCurrency,
            baseAmount: sentAmount,
            ...getInboundFee(txId, thornodeTxs, inputCoin.asset, protocol),
            from: input.address,
            to: protocol.counterparty,
            blockchain,
            id: `${idPrefix}.refund`,
            description: `refund (${txId}): ${reason}`,
        });

        // What came back can be less than what was sent: the protocol keeps its outbound fee. That part is
        // gone, and nothing else records it. Use the amounts, not Midgard's networkFees, which can differ.
        const returnedAmount = returned.reduce((sum, coin) => sum + BigInt(coin.amount), 0n);
        const keptAmount = BigInt(inputCoin.amount) - returnedAmount;

        if (keptAmount > 0n) {
            const returnTxId = action.out.find((out) => out.txID)?.txID;
            const returnedNote = `${baseToAssetAmountString(returnedAmount.toString(), decimals)} ${inputCurrency} returned`
                + (returnTxId ? ` in ${returnTxId}` : '');

            transactions.push({
                walletExchange: input.address,
                timestamp,
                type: CryptoTaxTransactionType.Fee,
                baseCurrency: inputCurrency,
                baseAmount: baseToAssetAmountString(keptAmount.toString(), decimals),
                from: input.address,
                to: protocol.counterparty,
                blockchain,
                id: `${idPrefix}.refund-fee`,
                description: `refund (${txId}): kept by ${protocol.counterparty}, ${sentAmount} ${inputCurrency} sent, ${returnedNote}`,
            });
        }

        return transactions;
    }
}
