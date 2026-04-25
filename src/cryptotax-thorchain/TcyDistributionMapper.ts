import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../cryptotax";
import {TcyDistributionItem} from "./TcyDistributionService";
import {baseToAssetAmountString} from "../utils/Amount";

export class TcyDistributionMapper {
    constructor(private item: TcyDistributionItem, private walletAddress: string) {}

    // Convert Unix timestamp to Date
    static parseDate(item: TcyDistributionItem): Date {
        return new Date(parseInt(item.date) * 1000);
    }

    toCtc(): CryptoTaxTransaction[] {
        const amount = baseToAssetAmountString(this.item.amount);
        const price = baseToAssetAmountString(this.item.price);
        const date = TcyDistributionMapper.parseDate(this.item);
        const timestamp: string = date.toISOString();
        const idPrefix: string = date.toISOString();

        const tx: CryptoTaxTransaction = {
            walletExchange: this.walletAddress,
            timestamp,
            type: CryptoTaxTransactionType.Staking,
            baseCurrency: 'RUNE',
            baseAmount: amount,
            from: 'thorchain',
            to: this.walletAddress,
            blockchain: 'THORChain',
            description: `1/1 - Received ${amount} RUNE from TCY staking`,
            id: `${idPrefix}.staking`,
            referencePricePerUnit: price,
            referencePriceCurrency: 'USD'
        };

        return [tx];
    }
}
