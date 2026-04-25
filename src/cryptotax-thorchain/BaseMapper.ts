import { Action } from '@xchainjs/xchain-midgard';
import { CryptoTaxTransaction, CryptoTaxTransactionType } from '../cryptotax';
import { parseMidgardAsset, parseMidgardDate } from './MidgardUtils';
import { baseToAssetAmountString } from '../utils/Amount';
import { TxStatusResponse } from '@xchainjs/xchain-thornode';
import { Mapper } from './Mapper';
import { getPrice } from '../cmc-scraper';

export abstract class BaseMapper implements Mapper {
    protected mapperName: string = 'BaseMapper';
    protected idPrefix: string;
    protected timestamp: string;
    protected datetime: Date;
    protected transactions: CryptoTaxTransaction[] = [];

    constructor(protected action: Action, protected addReferencePrices: boolean, protected thornodeTxs: TxStatusResponse[] = []) {
        this.datetime = parseMidgardDate(action.date);
        this.timestamp = this.datetime.toISOString();
        this.idPrefix = this.datetime.toISOString();
    }

    abstract toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[]): CryptoTaxTransaction[];

    protected createTransaction(overrides: Partial<CryptoTaxTransaction>): CryptoTaxTransaction {
        return {
            walletExchange: '',
            timestamp: this.timestamp,
            type: CryptoTaxTransactionType.Unspecified, // Default type, to be overridden
            baseCurrency: '',
            baseAmount: '',
            from: '',
            to: '',
            blockchain: '',
            description: '',
            ...overrides,
        };
    }

    protected parseCoin(asset: string, amount: string): { blockchain: string; currency: string; displayCurrency: string; amountParsed: string } {
        const { blockchain, currency, displayCurrency } = parseMidgardAsset(asset);
        const amountParsed = baseToAssetAmountString(amount);
        return { blockchain, currency, displayCurrency, amountParsed };
    }

    protected handleReferencePrices(liquidityUnits: string, quoteCurrency: string, quoteAmount: string) {
        if (this.addReferencePrices) {
            const totalValue = getPrice(quoteCurrency, this.datetime) * parseFloat(quoteAmount);

            const referencePricePerUnit = (totalValue / parseFloat(liquidityUnits)).toString();

            return {
                referencePriceCurrency: 'USD',
                referencePricePerUnit,
            };
        }

        return {};
    }

    protected error(message: string): Error {
        console.log('action:', JSON.stringify(this.action, null, 4));
        return new Error(`${this.mapperName}: ${message}`);
    }
}
