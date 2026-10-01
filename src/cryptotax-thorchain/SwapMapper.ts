import { Action, Coin, Transaction } from '@xchainjs/xchain-midgard';
import { CryptoTaxTransaction, CryptoTaxTransactionType } from '../cryptotax';
import { TxStatusResponse } from '@xchainjs/xchain-thornode';
import { BaseMapper } from './BaseMapper';
import { formatBlockchainForOutput, getInboundFee } from './ThorchainUtils';
import { Protocol } from '../protocols/Protocol';

// https://dev.thorchain.org/concepts/memos.html#swap
const SWAP_DESTADDR = 2;

function isSynth(tx: Transaction): boolean {
    return tx.coins[0].asset.includes('/');
}

function getActualBlockchain(tx: Transaction, parsedBlockchain: string): string {
    return isSynth(tx) && tx.address.toLowerCase().startsWith('thor1') ? 'THOR' : parsedBlockchain;
}

// Wallet-A1 CSV
// * send currency A to thorchain

// Wallet B1 CSV
// * receive currency B from thorchain

export class SwapMapper extends BaseMapper {
    protected mapperName: string = 'SwapMapper';

    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = [], protocol?: Protocol): CryptoTaxTransaction[] {
        super.action = action;
        super.addReferencePrices = addReferencePrices;
        super.thornodeTxs = thornodeTxs;
        super.protocol = protocol ?? this.protocol;
        const counterparty = this.protocol.counterparty;

        const date_plus_10 = new Date(this.datetime.getTime() + 10 * 1000);
        const timestamp_plus_10: string = date_plus_10.toISOString();

        const transactions: CryptoTaxTransaction[] = [];

        const numAssetsIn: number = action.in.length;

        if (numAssetsIn !== 1) {
            throw this.error(`Expected numAssetsIn to be 1 but was ${numAssetsIn}`);
        }

        const input: Transaction = action.in[0];
        const inputCoin: Coin = input.coins[0];
        const output: Transaction = this.getOutput(action, action.metadata.swap?.memo);

        // The unfilled part of a streaming swap can be returned to the sender in the input asset.
        // Net it off, so the row shows what was actually swapped. See docs/specs/maya.md.
        const returnedAmount = this.getReturnedAmount(action, input, output);
        const swappedAmount = (BigInt(inputCoin.amount) - returnedAmount).toString();
        const { blockchain: inputBlockchainParsed, currency: inputCurrency, displayCurrency: inputDisplayCurrency, amountParsed: inputAmount } = this.parseCoin(inputCoin.asset, swappedAmount);
        const returnedNote = returnedAmount > 0n
            ? ` (${this.parseCoin(inputCoin.asset, returnedAmount.toString()).amountParsed} ${inputDisplayCurrency} returned unfilled)`
            : '';
        const inputIsSynth: boolean = isSynth(input);
        const inputBlockchain = getActualBlockchain(input, inputBlockchainParsed);

        const txId = action.in[0].txID ?? '';
        const inputPriceUSD = action.metadata.swap?.inPriceUSD;
        const outputPriceUSD = action.metadata.swap?.outPriceUSD;

        const outputCoin: Coin = output.coins[0];
        const { blockchain: outputBlockchainParsed, currency: outputCurrency, displayCurrency: outputDisplayCurrency, amountParsed: outputAmount } = this.parseCoin(outputCoin.asset, outputCoin.amount);
        const outputIsSynth: boolean = isSynth(output);
        const outputBlockchain = getActualBlockchain(output, outputBlockchainParsed);

        if (!inputCurrency) {
            throw this.error('No input currency');
        }

        if (!inputAmount) {
            throw this.error('No input amount');
        }

        console.log(
            `${this.timestamp} swap ${inputBlockchain}.${inputDisplayCurrency}${
                inputIsSynth ? ' *synth*' : ''
            } to ${outputBlockchain}.${outputDisplayCurrency}${outputIsSynth ? ' *synth*' : ''} - ${input.txID ?? output.txID}`
        );

        // If synth (eg. BTC/BTC) but address is not thor, then ignore. Likely a savers withdrawal.
        if (inputIsSynth && !input.address.startsWith('thor1')) {
            console.log('SWAP IGNORED');
            return [];
        }

        // Can appear with lending transactions
        if (inputCoin.asset === 'THOR.TOR' || outputCoin.asset === 'THOR.TOR') {
            throw this.error('Invalid swap - THOR.TOR');
        }

        const { feeCurrency, feeAmount } = getInboundFee(txId, thornodeTxs, inputCoin.asset);

        // Wallet A1 - Send asset A to thorchain --------------------------------------------------

        transactions.push({
            walletExchange: input.address,
            timestamp: this.timestamp,
            type: CryptoTaxTransactionType.BridgeTradeOut,
            baseCurrency: inputCurrency,
            baseAmount: inputAmount,
            quoteCurrency: outputCurrency,
            quoteAmount: outputAmount,
            feeCurrency,
            feeAmount,
            from: input.address,
            to: counterparty,
            blockchain: formatBlockchainForOutput(inputBlockchain),
            referencePricePerUnit: inputPriceUSD || undefined,
            referencePriceCurrency: inputPriceUSD ? 'USD' : undefined,
            id: `${this.idPrefix}.${this.protocol.id}.bridge-trade-out`,
            description: `1/2 - Swap ${inputAmount} ${inputIsSynth ? 'Synth ' : ''}${inputDisplayCurrency} to ${outputAmount} ${
                outputIsSynth ? 'Synth ' : ''
            }${outputDisplayCurrency}${returnedNote}; ${txId}`,
        });

        // Wallet B1 - Receive asset B from thorchain ---------------------------------------------

        transactions.push({
            walletExchange: output.address,
            timestamp: timestamp_plus_10,
            type: CryptoTaxTransactionType.BridgeTradeIn,
            baseCurrency: outputCurrency,
            baseAmount: outputAmount,
            from: counterparty,
            to: output.address,
            blockchain: formatBlockchainForOutput(outputBlockchain),
            referencePricePerUnit: outputPriceUSD || undefined,
            referencePriceCurrency: outputPriceUSD ? 'USD' : undefined,
            id: `${this.idPrefix}.${this.protocol.id}.bridge-trade-in`,
            description: `2/2 - Swap ${inputAmount} ${inputIsSynth ? 'Synth ' : ''}${inputDisplayCurrency} to ${outputAmount} ${
                outputIsSynth ? 'Synth ' : ''
            }${outputDisplayCurrency}; ${txId}`,
        });

        return transactions;
    }

    // Sum of outputs, other than the swap output, returned to the sender in the input asset
    getReturnedAmount(action: Action, input: Transaction, output: Transaction): bigint {
        const inputAsset = input.coins[0].asset;

        return action.out
            .filter(out => out !== output && out.address.toLowerCase() === input.address.toLowerCase())
            .flatMap(out => out.coins)
            .filter(coin => coin.asset === inputAsset)
            .reduce((sum, coin) => sum + BigInt(coin.amount), 0n);
    }

    // Find which output is for the user. As there may also be an output for an affiliate.
    getOutput(action: Action, memo: string | undefined): Transaction {
        if (!memo) {
            throw this.error('No memo');
        }

        const destAddress = this.getDestAddress(memo);

        if (!destAddress) {
            // A swap memo with an empty destination (e.g. =:ARB.ETH:::wr:0). Maya paid such a swap out to
            // the sender's address (same EVM address on another chain). Only accept an output in a different
            // asset from the input, so a refund of the input is never read as the swap.
            // (A send to a vault with no memo at all is refunded, and Midgard reports it as a refund action.)
            const sender = action.in[0].address.toLowerCase();
            const inputAsset = action.in[0].coins[0]?.asset;
            const out = action.out.find((out) => out.address.toLowerCase() === sender && out.coins[0]?.asset !== inputAsset);

            if (!out) {
                throw this.error('No matching out tx');
            }

            return out;
        }

        const out = action.out.find((out) => out.address.toLowerCase() === destAddress.toLowerCase());

        if (!out) {
            throw this.error('No matching out tx');
        }

        return out;
    }

    getDestAddress(memo: string): string {
        return memo.split(':')[SWAP_DESTADDR];
    }
}
