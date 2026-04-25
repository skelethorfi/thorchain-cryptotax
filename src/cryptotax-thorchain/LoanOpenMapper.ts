import {Mapper} from "./Mapper";
import {Action, Coin, Transaction} from "@xchainjs/xchain-midgard";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../cryptotax";
import {parseMidgardAsset, parseMidgardDate} from "./MidgardUtils";
import {baseToAssetAmountString} from "../utils/Amount";
import {isEmpty} from "lodash";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {formatBlockchainForOutput} from "./ThorchainUtils";

// https://dev.thorchain.org/concepts/memos.html#open-loan
const LOANOPEN_DESTADDR = 2;
const AFFILIATE = 4;

// Wallet-A1 CSV
// * [collateral-deposit] send currency A to thorchain

// Wallet B1 CSV
// * [loan] receive currency B from thorchain

export class LoanOpenMapper implements Mapper {
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = []): CryptoTaxTransaction[] {

        const numAssetsIn: number = action.in.length;

        if (numAssetsIn !== 1) {
            throw this.error(`numAssetsIn must be 1 but was ${numAssetsIn}`, action);
        }

        const date: Date = parseMidgardDate(action.date);
        const timestamp: string = date.toISOString();

        const idPrefix: string = date.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const {
            input,
            inputAddress,
            inputBlockchain,
            inputCurrency,
            inputAmount,
            memo,
            txId
        } = this.getInput(action, thornodeTxs);

        const output = this.getOutput(action, memo);
        const outputCoin: Coin = output.coins[0];
        const {blockchain: outputBlockchain, currency: outputCurrency} =
            parseMidgardAsset(outputCoin.asset);
        const outputAmount: string = baseToAssetAmountString(outputCoin.amount);

        if (!inputCurrency) {
            throw this.error('No input currency', action);
        }

        if (!inputAmount) {
            throw this.error('No input amount', action);
        }

        // TODO: could probably add liquidity/affiliate/network fees together and put it all on the 'loan' tx, as the
        // 'collateral' tx won't be imported anyway since it will come from the BTC/ETH wallet.
        // assumes the loan tx is to rune though

        const liquidityFee = {
            feeCurrency: 'RUNE',
            feeAmount: baseToAssetAmountString(action.metadata.swap?.liquidityFee ?? '')
        };
        const affiliateFee = this.getAffiliateFee(action);

        // TODO: if there is an affiliate there will be 2 outs, and 2 network fees
        const networkFee = this.getNetworkFee(action);

        // Wallet A1 - [collateral-deposit] send currency A to thorchain -----------------------------------------------

        transactions.push({
            walletExchange: inputAddress,
            timestamp,
            type: CryptoTaxTransactionType.CollateralDeposit,
            baseCurrency: inputCurrency,
            baseAmount: inputAmount,
            ...liquidityFee,
            from: inputAddress,
            to: 'thorchain',
            blockchain: formatBlockchainForOutput(inputBlockchain),
            id: `${idPrefix}.collateral-deposit`,
            description: `1/2 - LoanOpen deposit ${inputCurrency} to borrow ${outputCurrency}; ${txId}`,
        });

        // Wallet B1 - [loan] receive currency B from thorchain --------------------------------------------------------

        transactions.push({
            walletExchange: output.address,
            timestamp,
            type: CryptoTaxTransactionType.Loan,
            baseCurrency: outputCurrency,
            baseAmount: outputAmount,
            // Just taking affiliateFee if it's there instead of adding them together in case they are different assets
            ...(!isEmpty(affiliateFee) ? affiliateFee : networkFee),
            from: 'thorchain',
            to: output.address,
            blockchain: formatBlockchainForOutput(outputBlockchain),
            id: `${idPrefix}.loan`,
            description: `2/2 - LoanOpen deposit ${inputCurrency} to borrow ${outputCurrency}; ${txId}`,
        });

        return transactions;
    }

    private getInput(action: Action, thornodeTxs: TxStatusResponse[]) {

        if (action.in[0].coins[0].asset === 'THOR.TOR') {
            const tx = thornodeTxs[0];
            const input = tx.tx;
            const inputCoin = input?.coins[0];

            if (!inputCoin) {
                console.log(thornodeTxs[0]);
                throw this.error('Missing input coin', action);
            }

            const {blockchain: inputBlockchain, currency: inputCurrency} =
                parseMidgardAsset(inputCoin.asset);
            const inputAmount: string = baseToAssetAmountString(inputCoin.amount);
            const txId = input?.id;
            const memo = input?.memo;
            const inputAddress = input?.from_address;

            return {input, inputAddress, inputBlockchain, inputCurrency, inputAmount, memo, txId};
        }

        const input: Transaction = action.in[0];
        const inputCoin: Coin = input.coins[0];
        const {blockchain: inputBlockchain, currency: inputCurrency} =
            parseMidgardAsset(inputCoin.asset);
        const inputAmount: string = baseToAssetAmountString(inputCoin.amount);
        const txId = input.txID;
        const memo = action.metadata.swap?.memo;
        const inputAddress = input.address;

        return {input, inputAddress, inputBlockchain, inputCurrency, inputAmount, memo, txId};
    }

    // Find which output is for the user
    getOutput(action: Action, memo: string | undefined): Transaction {
        if (!memo) {
            throw this.error('No memo', action);
        }

        const destAddress = this.getDestAddress(memo);
        const out = action.out.find(out => out.address.toLowerCase() === destAddress.toLowerCase());

        if (!out) {
            throw this.error('No matching out tx', action);
        }

        return out;
    }

    getDestAddress(memo: string): string {
        return memo.split(':')[LOANOPEN_DESTADDR];
    }

    getAffiliateAddress(memo: string): string {
        return memo.split(':')[AFFILIATE];
    }

    getNetworkFee(action: Action) {
        const {currency: feeCurrency} =
            parseMidgardAsset(action.metadata.swap?.networkFees[0].asset ?? '');

        const feeAmount= baseToAssetAmountString(action.metadata.swap?.networkFees[0].amount ?? '');

        return {
            feeCurrency,
            feeAmount
        };
    }

    getAffiliateFee(action: Action) {
        const memo = action.metadata.swap?.memo;

        if (!memo) {
            throw this.error('No memo', action);
        }

        const affiliateAddress = this.getAffiliateAddress(memo);
        const out = action.out.find(out => out.address == affiliateAddress);

        if (!out) {
            return {};
        }

        const {currency: feeCurrency} = parseMidgardAsset(out.coins[0].asset)
        const feeAmount = baseToAssetAmountString(out.coins[0].amount)

        return {
            feeCurrency,
            feeAmount
        };
    }

    error(message: string, action: Action) {
        console.log('action:', JSON.stringify(action, null, 4));
        return new Error(`LoanOpenMapper: ${message}`);
    }
}
