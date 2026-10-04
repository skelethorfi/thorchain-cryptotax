import {Mapper} from "./Mapper";
import {Action, Coin, Transaction} from "@xchainjs/xchain-midgard";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../cryptotax";
import {parseMidgardAsset, parseMidgardDate} from "./MidgardUtils";
import {baseToAssetAmountString} from "../utils/Amount";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {formatBlockchainForOutput, getInboundFee} from "./ThorchainUtils";

// https://dev.thorchain.org/concepts/memos.html#open-loan
const LOANOPEN_DESTADDR = 2;

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
            inputAsset,
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

        // The fee is the gas paid to send the collateral in (docs/specs/fees.md). Liquidity, affiliate
        // and outbound fees are already reflected in the loan amount.
        const inboundFee = getInboundFee(txId ?? '', thornodeTxs, inputAsset);

        // Wallet A1 - [collateral-deposit] send currency A to thorchain -----------------------------------------------

        transactions.push({
            walletExchange: inputAddress,
            timestamp,
            type: CryptoTaxTransactionType.CollateralDeposit,
            baseCurrency: inputCurrency,
            baseAmount: inputAmount,
            ...inboundFee,
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
                throw this.error('Missing input coin', action);
            }

            const {blockchain: inputBlockchain, currency: inputCurrency} =
                parseMidgardAsset(inputCoin.asset);
            const inputAmount: string = baseToAssetAmountString(inputCoin.amount);
            const txId = input?.id;
            const memo = input?.memo;
            const inputAddress = input?.from_address;

            return {input, inputAddress, inputBlockchain, inputCurrency, inputAmount, inputAsset: inputCoin.asset, memo, txId};
        }

        const input: Transaction = action.in[0];
        const inputCoin: Coin = input.coins[0];
        const {blockchain: inputBlockchain, currency: inputCurrency} =
            parseMidgardAsset(inputCoin.asset);
        const inputAmount: string = baseToAssetAmountString(inputCoin.amount);
        const txId = input.txID;
        const memo = action.metadata.swap?.memo;
        const inputAddress = input.address;

        return {input, inputAddress, inputBlockchain, inputCurrency, inputAmount, inputAsset: inputCoin.asset, memo, txId};
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




    error(message: string, action: Action) {
        return new Error(`LoanOpenMapper: ${message}`);
    }
}
