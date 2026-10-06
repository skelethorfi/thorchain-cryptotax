import {Configuration, TransactionsApi, TxStatusResponse} from "@xchainjs/xchain-thornode";
import {RecordStore} from "../store/RecordStore";
import {THORNODE_RULES} from "../store/Sources";
import {API_URLS} from "../../config/apiUrls";
import {http} from "../http";

// Seems like not all transactions may be on the latest API URL
// Following how THORChain Explorer handles it - https://github.com/thorchain/thorchain-explorer-v2/blob/main/api/thornode.api.js

export class ThornodeService {
    api: TransactionsApi;
    archive: TransactionsApi;

    constructor(private store: RecordStore = new RecordStore('_cache'), private source: string = 'thornode') {
        this.api = new TransactionsApi(new Configuration({basePath: API_URLS.thornode}), API_URLS.thornode, http);
        this.archive = new TransactionsApi(new Configuration({basePath: API_URLS.thornodeArchive}), API_URLS.thornodeArchive, http);
    }

    // date: of the action the tx belongs to; a tx status has no date of its own to be filed by
    async getTxStatus(hash: string, date?: Date): Promise<TxStatusResponse> {
        if (!hash) {
            throw new Error('No transaction hash');
        }

        return this.store.record(this.source, hash, () => this.fetchTxStatus(hash), THORNODE_RULES, date);
    }

    private async fetchTxStatus(hash: string) {
        const tx = (await this.api.txStatus(hash)).data;

        // If the transaction data does not exist then fetch it from the archive
        if (!tx.tx) {
            return {data: (await this.archive.txStatus(hash)).data, url: `${API_URLS.thornodeArchive}/thorchain/tx/status/${hash}`};
        }

        return {data: tx, url: `${API_URLS.thornode}/thorchain/tx/status/${hash}`};
    }
}
