import {Configuration, TransactionsApi, TxStatusResponse} from "@xchainjs/xchain-thornode";
import axios from "axios";
import axiosThrottle from 'axios-request-throttle';
import {RecordStore} from "../cache/RecordStore";
import {THORNODE_RULES} from "../cache/Sources";
import {API_URLS} from "../config/apiUrls";

// Seems like not all transactions may be on the latest API URL
// Following how THORChain Explorer handles it - https://github.com/thorchain/thorchain-explorer-v2/blob/main/api/thornode.api.js
axiosThrottle.use(axios, { requestsPerSecond: 1 });

export class ThornodeService {
    api: TransactionsApi;
    archive: TransactionsApi;

    constructor(private store: RecordStore = new RecordStore('_cache'), private source: string = 'thornode') {
        this.api = new TransactionsApi(new Configuration({basePath: API_URLS.thornode}));
        this.archive = new TransactionsApi(new Configuration({basePath: API_URLS.thornodeArchive}));
    }

    async getTxStatus(hash: string): Promise<TxStatusResponse> {
        if (!hash) {
            throw new Error('No transaction hash');
        }

        return this.store.record(this.source, hash, () => this.fetchTxStatus(hash), THORNODE_RULES);
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

async function test() {
    const hash = '';
    const thornode = new ThornodeService();
    const tx = await thornode.getTxStatus(hash);
    console.log(tx);
}

if (require.main === module) {
    console.log('Test: ' + __filename);
    test();
}
