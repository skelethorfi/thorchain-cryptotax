import {AnyAsset, assetFromStringEx} from "@xchainjs/xchain-util";
import {BaseMapper} from "./BaseMapper";
import {ViewblockCoin, ViewblockEvent, ViewblockEventSend, ViewblockTx} from "../viewblock";
import {baseToAssetAmountString} from "../utils/Amount";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../cryptotax";
import assert from "assert";

export class DelegateArkeoMapper extends BaseMapper {
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

        // Categorising this as a send, as it is a send to yourself, only the fee should apply.
        ctcTx.type = CryptoTaxTransactionType.Send;

        ctcTx.timestamp = this.datetime;

        assert.equal(1, event.params.coins.length);

        const coin: ViewblockCoin = event.params.coins[0];

        // Amount
        ctcTx.baseAmount = baseToAssetAmountString(coin.amount);

        const assetStr = coin.asset;
        let asset: AnyAsset;

        try {
            asset = assetFromStringEx(assetStr);
        } catch (e) {
            throw new Error(`[Viewblock] Failed to parse asset string "${assetStr}". type: send, txid: ${this.tx.hash}`);
        }

        ctcTx.baseCurrency = asset.ticker;
        ctcTx.feeCurrency = 'RUNE';
        ctcTx.feeAmount = baseToAssetAmountString(event.fee.amount[0].amount);
        ctcTx.from = from;
        ctcTx.to = to;
        ctcTx.blockchain = 'THOR'; // Sends/receives will only be for thorchain
        ctcTx.id = this.getId(ctcTx.type);
        ctcTx.description = `1/1 - DelegateArkeoWallet; ${this.tx.hash}`;

        return [ctcTx];
    }
}
