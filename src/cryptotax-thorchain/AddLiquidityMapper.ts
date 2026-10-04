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
import { Issue } from '../domain/Issue';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import { Protocol, THORCHAIN } from '../protocols/Protocol';
import { getInboundFee, getLpTokenName } from './ThorchainUtils';

export class AddLiquidityMapper implements Mapper {
    issues: Issue[] = [];

    toCryptoTax(action: Action, thornodeTxs: TxStatusResponse[] = [], protocol: Protocol = THORCHAIN): CryptoTaxTransaction[] {
        const numAssetsIn: number = action.in.length;

        if (numAssetsIn === 0 || numAssetsIn > 2) {
            throw this.error(`numAssetsIn must either be 1 or 2 but was ${numAssetsIn}`, action);
        }

        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();
        const liquidityUnits: string = baseToAssetAmountString(
            action.metadata.addLiquidity?.liquidityUnits ?? ''
        );
        const isSavers: boolean = action.pools[0].includes('/');
        const symmDesc = isSavers ? 'savers' : (numAssetsIn === 2 ? 'symmetric' : 'asymmetric');
        const txId = action.in[0].txID ?? '';

        // Savers units are denominated in the asset saved, not pool LP units, so a savers position has its own
        // token (e.g. ThorSavers.BTC.BTC; docs/specs/savers.md)
        const lpToken: string = getLpTokenName(action.pools[0], protocol);

        const date_plus_10 = new Date(date.getTime() + (10 * 1000));
        const date_plus_20 = new Date(date.getTime() + (20 * 1000));
        const timestamp_plus_10: string = date_plus_10.toISOString();
        const timestamp_plus_20: string = date_plus_20.toISOString();

        const totalTxs = numAssetsIn + 2;
        let currentTxNum = 1;
        const transactions: CryptoTaxTransaction[] = [];

        // Deposit asset(s)
        // Deposits are associated with the input addresses (i.e. walletExchange)
        // and exported to separate CSVs

        for (let i = 0; i < numAssetsIn; i++) {
            const deposit: Transaction = action.in[i];
            const coin: Coin = deposit.coins[0];
            let from = deposit.address;

            // Some older transactions for BNB LP seem to be missing the deposit address on the RUNE side.
            // They also have a txId of genesisTx
            if (!from) {
                from = 'MISSING-DEPOSIT-ADDRESS';
            }

            // Midgard reports a savers deposit's coin as the synth (BTC/BTC), but a wallet on the asset's own
            // chain sent the L1 asset (BTC, not ThorSynth.BTC.BTC) and paid that chain's gas, not the protocol's native fee
            const sentOnL1 = isSavers && !from.toLowerCase().startsWith(protocol.nativeAddressPrefix);
            const sentAsset = sentOnL1 ? coin.asset.replace('/', '.') : coin.asset;
            const { blockchain, currency } = parseMidgardAsset(sentAsset, protocol);

            transactions.push({
                walletExchange: from,
                timestamp,
                type: CryptoTaxTransactionType.AddLiquidity,
                baseCurrency: currency,
                baseAmount: baseToAssetAmountString(coin.amount, protocol.decimals(coin.asset)),
                ...getInboundFee(deposit.txID ?? '', thornodeTxs, sentAsset, protocol),
                from: from,
                to: protocol.counterparty,
                blockchain,
                id: `${idPrefix}.add-liquidity.${currency}`,
                description: `${currentTxNum}/${totalTxs} - Add liquidity ${currency} to ${lpToken} (${symmDesc}); ${txId}`,
            });

            currentTxNum++;
        }

        // Market price for LP units

        // When importing from CSV, CTC does not automatically add the market price to the receive LP token transaction.
        // They should be able to as they can already determine the value of the assets being deposited. Maybe they will in the future.
        // For now, I am creating an additional transaction and marking it as spam, so it is ignored.
        // This transaction will be used to determine the market price of the assets added to the pool. It won't match exactly compared to manually
        // adding the value of the 2 assets in CTC due to price discrepancies, but hopefully work well enough.
        // This method is just multiplying the first asset amount by 2 (where 2 assets are added).
        // After importing, view all the transactions from the import, unhide spam transactions, and then copy the value from each spam transaction to
        // each receive LP token transaction.

        // Use the asset(s) added as the quote currency/amount.
        // This is used by CryptoTaxCalculator to determine the market price of the liquidity units received.
        const quoteCurrency: string = transactions[0].baseCurrency;

        // If 2 assets are added then it should be 50/50, so we double the amount when determining the total amount of value added to the pool.
        // e.g. if depositing 100 RUNE + 0.01 BTC then the deposit is equal to 200 RUNE in total value added (or 0.02 BTC)
        const quoteAmount: string = (
            parseFloat(transactions[0].baseAmount) * numAssetsIn
        ).toString();

        if (!action.in[0].address) {
            this.issues.push({kind: 'warning', message: 'missing deposit address'});
        }

        // Check if the native asset (e.g. RUNE) is not the first asset in the deposit
        if (numAssetsIn === 2 && action.in[0].coins[0].asset !== protocol.nativeAsset) {
            // TODO: search inputs for the native side (if available)
            throw this.error(`Expected ${protocol.nativeAsset.split('.')[1]} as first asset in LP deposit`, action);
        }

        let lpTokenReceivingAddress = action.in[0].address;

        if (!lpTokenReceivingAddress) {
            lpTokenReceivingAddress = 'MISSING-DEPOSIT-ADDRESS';
        }

        // Receive liquidity units

        transactions.push({
            walletExchange: lpTokenReceivingAddress,
            timestamp: timestamp_plus_10,
            type: CryptoTaxTransactionType.ReceiveLpToken,
            baseCurrency: lpToken,
            baseAmount: liquidityUnits,
            from: protocol.counterparty,
            to: lpTokenReceivingAddress,
            blockchain: protocol.blockchain,
            id: `${idPrefix}.receive-lp-token`,
            description: `${currentTxNum}/${totalTxs} - Receive LP token from ${lpToken} (${symmDesc}); ${txId}`
        });

        currentTxNum++;

        transactions.push({
            walletExchange: lpTokenReceivingAddress,
            timestamp: timestamp_plus_20,
            type: CryptoTaxTransactionType.Spam,
            baseCurrency: quoteCurrency,
            baseAmount: quoteAmount,
            from: protocol.counterparty,
            to: lpTokenReceivingAddress,
            id: `${idPrefix}.spam`,
            description:
                `${currentTxNum}/${totalTxs} - Dummy transaction to get market price to then manually apply to the receive LP token transaction ${lpToken} (${symmDesc}); ${txId}`,
        });

        return transactions.reverse();
    }

    error(message: string, action: Action) {
        return new Error(`AddLiquidityMapper: ${message}`);
    }
}
