import { Action, Coin, Transaction } from '@xchainjs/xchain-midgard';
import {
    CryptoTaxTransaction,
    CryptoTaxTransactionType,
} from '../cryptotax';
import { getPrice } from "../cmc-scraper";
import {
    parseMidgardAsset,
    parseMidgardDate,
    parseMidgardPool,
} from './MidgardUtils';
import { baseToAssetAmountString } from '../utils/Amount';
import { Mapper } from './Mapper';
import {TxStatusResponse} from "@xchainjs/xchain-thornode";

export class AddLiquidityMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {
        const numAssetsIn: number = action.in.length;

        if (numAssetsIn === 0 || numAssetsIn > 2) {
            throw this.error(`numAssetsIn must either be 1 or 2 but was ${numAssetsIn}`, action);
        }

        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();
        const pool: string = parseMidgardPool(action.pools[0]);
        const poolName: string = `ThorLP.${pool}`;
        const liquidityUnits: string = baseToAssetAmountString(
            action.metadata.addLiquidity?.liquidityUnits ?? ''
        );
        const isSavers: boolean = action.pools[0].includes('/');
        const symmDesc = isSavers ? 'savers' : (numAssetsIn === 2 ? 'symmetric' : 'asymmetric');
        const txId = action.in[0].txID ?? '';

        // For savers the LP units are denominated in the asset used for saving, so we need to ensure it
        // uses a different token name. eg. ThorLP.BTC/BTC
        const lpToken: string = isSavers ? `ThorLP.${action.pools[0]}` : `ThorLP.${pool}`;

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
            const { blockchain, currency } = parseMidgardAsset(coin.asset);

            let from = deposit.address;

            // Some older transactions for BNB LP seem to be missing the deposit address on the RUNE side.
            // They also have a txId of genesisTx
            if (!from) {
                from = 'MISSING-DEPOSIT-ADDRESS';
            }

            transactions.push({
                walletExchange: from,
                timestamp,
                type: CryptoTaxTransactionType.AddLiquidity,
                baseCurrency: currency,
                baseAmount: baseToAssetAmountString(coin.amount),
                from: from,
                to: 'thorchain',
                blockchain,
                id: `${idPrefix}.add-liquidity.${currency}`,
                description: `${currentTxNum}/${totalTxs} - Add liquidity ${currency} to ${poolName} (${symmDesc}); ${txId}`,
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

        let referencePrice = {};

        if (addReferencePrices) {
            const totalValue = getPrice(quoteCurrency, date) * parseFloat(quoteAmount);
            const referencePricePerUnit = (totalValue / parseFloat(liquidityUnits)).toString();

            referencePrice = {
                referencePriceCurrency: 'USD',
                referencePricePerUnit
            };
        }

        if (!action.in[0].address) {
            console.warn('Missing deposit address');
        }

        // Check if RUNE is not the first asset in the deposit
        if (numAssetsIn === 2 && action.in[0].coins[0].asset !== 'THOR.RUNE') {
            // TODO: search inputs for RUNE side (if available)
            throw this.error(`Expected RUNE as first asset in LP deposit`, action);
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
            from: 'thorchain',
            to: lpTokenReceivingAddress,
            blockchain: 'THORChain',
            id: `${idPrefix}.receive-lp-token`,
            description: `${currentTxNum}/${totalTxs} - Receive LP token from ${poolName} (${symmDesc}); ${txId}`,
            ...referencePrice
        });

        currentTxNum++;

        transactions.push({
            walletExchange: lpTokenReceivingAddress,
            timestamp: timestamp_plus_20,
            type: CryptoTaxTransactionType.Spam,
            baseCurrency: quoteCurrency,
            baseAmount: quoteAmount,
            from: 'thorchain',
            to: lpTokenReceivingAddress,
            id: `${idPrefix}.spam`,
            description:
                `${currentTxNum}/${totalTxs} - Dummy transaction to get market price to then manually apply to the receive LP token transaction ${poolName} (${symmDesc}); ${txId}`,
        });

        return transactions.reverse();
    }

    error(message: string, action: Action) {
        console.log('action:', JSON.stringify(action, null, 4));
        return new Error(`AddLiquidityMapper: ${message}`);
    }
}
