import {AnyAsset, assetFromStringEx, AssetType} from "@xchainjs/xchain-util";
import {BaseMapper} from "./BaseMapper";
import {ViewblockCoin, ViewblockEvent, ViewblockEventSend, ViewblockTx} from "../../sources/viewblock";
import { baseToAssetAmountString } from "../../utils/Amount";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../../export/summ/csv";
import assert from "assert";
import {THORCHAIN} from "../../domain/Protocol";

export class SendMapper extends BaseMapper {
    constructor(tx: ViewblockTx, wallet: string) {
        super(tx, wallet);
    }

    toCtc() {
        const ctcTx: CryptoTaxTransaction = {} as any;

        // Set the current wallet. Used for exporting into related CSV
        ctcTx.walletExchange = this.wallet;

        const event: ViewblockEvent = this.getEvent('send') as ViewblockEventSend;
        const from = event.params.fromAddress;
        const to = event.params.toAddress;

        let isSend = false;

        if (from === this.wallet) {
            ctcTx.type = CryptoTaxTransactionType.Send;
            isSend = true;
        } else if (to === this.wallet) {
            ctcTx.type = CryptoTaxTransactionType.Receive;
        } else {
            assert.fail('failed to determine send or receive');
        }

        ctcTx.timestamp = this.datetime;

        assert.equal(1, event.params.coins.length);

        const coin: ViewblockCoin = event.params.coins[0];

        // Amount
        ctcTx.baseAmount = baseToAssetAmountString(coin.amount);

        const assetStr = coin.asset;
        let asset: AnyAsset;
        let isSynth = false;
        let isTrade = false;
        let ticker: string;

        // Asset samples
        // ============================
        // THOR.RUNE
        // DOGE/DOGE    Synth DOGE
        // TCY          THORChain Yield
        // X/RUJI       TODO: confirm how this is handled, would it be flagged as synth?

        try {
            asset = assetFromStringEx(assetStr);
            isSynth = asset.type === AssetType.SYNTH;
            isTrade = asset.type === AssetType.TRADE;
            ticker = asset.ticker;
        } catch (e) {
            // I would expect THOR.TCY, like THOR.RUNE. But that's not how it comes through.
            // TODO: Using custom handling of TCY for now, but consider just allowing anything.
            if (assetStr === 'TCY') {
                ticker = 'TCY';
                isSynth = false;
                isTrade = false;
            } else {
                // For other unknown assets, still throw the error
                throw new Error(`[Viewblock] Failed to parse asset string "${assetStr}". type: send, txid: ${this.tx.hash}`);
            }
        }

        ctcTx.baseCurrency = ticker;

        // Fee
        // Only apply the fee on send (not on receive)
        if (ctcTx.type === CryptoTaxTransactionType.Send) {
            ctcTx.feeCurrency = 'RUNE';
            ctcTx.feeAmount = baseToAssetAmountString(event.fee.amount[0].amount);
        }

        ctcTx.from = from;
        ctcTx.to = to;
        ctcTx.blockchain = THORCHAIN.blockchain; // Sends/receives will only be for thorchain
        ctcTx.id = this.getId(ctcTx.type);
        ctcTx.description = `${isSend ? 'Send' : 'Receive'} ${ctcTx.baseAmount} ${isSynth ? 'Synth ' : ''}${isTrade ? 'Trade ' : ''}${ticker}; ${this.tx.hash}`;

        return [ctcTx];
    }
}
