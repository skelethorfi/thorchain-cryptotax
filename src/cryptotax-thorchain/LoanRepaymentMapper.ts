import {Mapper} from "./Mapper";
import {Action, Coin, Transaction} from "@xchainjs/xchain-midgard";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../cryptotax";
import {parseMidgardAsset, parseMidgardDate} from "./MidgardUtils";
import {baseToAssetAmountString} from "../utils/Amount";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {formatBlockchainForOutput} from "./ThorchainUtils";

// https://dev.thorchain.org/concepts/memos.html#repay-loan
const REPAYLOAN_ASSET = 1;
const REPAYLOAN_DESTADDR = 2;

// Wallet-A1 CSV
// * [loan-repayment] send currency A to thorchain

// If loan is closed...
// Wallet B1 CSV
// * [collateral-withdrawal] receive currency B from thorchain

export class LoanRepaymentMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {

        const numAssetsIn: number = action.in.length;
        const numAssetsOut: number = action.out.length;

        if (numAssetsIn !== 1) {
            throw this.error(`numAssetsIn must be 1 but was ${numAssetsIn}`, action);
        }

        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();

        const idPrefix: string = date.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const input: Transaction = action.in[0];
        const inputCoin: Coin = input.coins[0];
        const {blockchain: inputBlockchain, currency: inputCurrency} =
            parseMidgardAsset(inputCoin.asset);
        const inputAmount: string = baseToAssetAmountString(inputCoin.amount);
        const txId = input.txID;

        if (!inputCurrency) {
            throw this.error('No input currency', action);
        }

        if (!inputAmount) {
            throw this.error('No input amount', action);
        }

        const liquidityFee = {
            feeCurrency: 'RUNE',
            feeAmount: baseToAssetAmountString(action.metadata.swap?.liquidityFee ?? '')
        };

        const networkFee = this.getNetworkFee(action);

        const {currency: collateralAsset} = parseMidgardAsset(this.getRepayAsset(this.getMemo(action)));

        const isClosed = numAssetsOut == 1;

        // Wallet A1 - [loan-repayment] send currency A to thorchain ---------------------------------------------------

        transactions.push({
            walletExchange: input.address,
            timestamp,
            type: CryptoTaxTransactionType.LoanRepayment,
            baseCurrency: inputCurrency,
            baseAmount: inputAmount,
            ...liquidityFee,
            from: input.address,
            to: 'thorchain',
            blockchain: formatBlockchainForOutput(inputBlockchain),
            id: `${idPrefix}.loan-repayment`,
            description: `1/${isClosed ? '2' : '1'} - LoanRepayment deposit ${inputCurrency} to repay ${collateralAsset} loan. ${isClosed ? 'Closed loan' : 'No closure'}; ${txId}`,
        });

        // Wallet B1 - [collateral-withdrawal] receive currency B from thorchain ---------------------------------------

        if (numAssetsOut == 1) {
            const output = this.getOutput(action);
            const outputCoin: Coin = output.coins[0];
            const {blockchain: outputBlockchain, currency: outputCurrency} =
                parseMidgardAsset(outputCoin.asset);
            const outputAmount: string = baseToAssetAmountString(outputCoin.amount);

            transactions.push({
                walletExchange: output.address,
                timestamp,
                type: CryptoTaxTransactionType.CollateralWithdrawal,
                baseCurrency: outputCurrency,
                baseAmount: outputAmount,
                ...networkFee,
                from: 'thorchain',
                to: output.address,
                blockchain: formatBlockchainForOutput(outputBlockchain),
                id: `${idPrefix}.collateral-withdrawal`,
                description: `2/2 - LoanRepayment deposit ${inputCurrency} to repay ${collateralAsset} loan. Closed loan; ${txId}`,
            });
        }

        return transactions;
    }

    getMemo(action: Action): string {
        const memo = action.metadata.swap?.memo;

        if (!memo) {
            throw this.error('No memo', action);
        }

        return memo;
    }

    // Find which output is for the user
    getOutput(action: Action): Transaction {
        const memo = this.getMemo(action);
        const destAddress = this.getDestAddress(memo);
        const out = action.out.find(out => out.address.toLowerCase() === destAddress.toLowerCase());

        if (!out) {
            throw this.error('No matching out tx', action);
        }

        return out;
    }

    getDestAddress(memo: string): string {
        return memo.split(':')[REPAYLOAN_DESTADDR];
    }

    getRepayAsset(memo: string): string {
        return memo.split(':')[REPAYLOAN_ASSET];
    }

    getNetworkFee(action: Action) {
        if (action.metadata.swap?.networkFees.length === 0) {
            return {};
        }

        const {currency: feeCurrency} =
            parseMidgardAsset(action.metadata.swap?.networkFees[0].asset ?? '');

        const feeAmount= baseToAssetAmountString(action.metadata.swap?.networkFees[0].amount ?? '');

        return {
            feeCurrency,
            feeAmount
        };
    }

    error(message: string, action: Action) {
        console.log('action:', JSON.stringify(action, null, 4));
        return new Error(`LoanRepaymentMapper: ${message}`);
    }
}
