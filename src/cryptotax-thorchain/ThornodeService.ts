import {Configuration, TransactionsApi, TxStatusResponse} from "@xchainjs/xchain-thornode";
import axios from "axios";
import axiosThrottle from 'axios-request-throttle';
import {Cache} from "../cache/Cache";
import {API_URLS} from "../config/apiUrls";

// Seems like not all transactions may be on the latest API URL
// Following how THORChain Explorer handles it - https://github.com/thorchain/thorchain-explorer-v2/blob/main/api/thornode.api.js
axiosThrottle.use(axios, { requestsPerSecond: 1 });

export class ThornodeService {
    cache: Cache;
    api: TransactionsApi;

    // Is this instance set to use the THORNode archive URL
    isArchive: boolean;

    // If this instance is using the current API URL then this will refer to the instance using the archive URL
    archive?: ThornodeService;

    constructor(cachePath: string = '_cache', isArchive: boolean = false) {
        this.isArchive = isArchive;

        // Current API and archive API both use the same cache path.
        // The response will not be cached if it's missing the transaction data.
        this.cache = new Cache(cachePath);

        const apiUrl = isArchive ? API_URLS.thornodeArchive : API_URLS.thornode;
        const apiConfig = new Configuration({basePath: apiUrl});
        this.api = new TransactionsApi(apiConfig);

        if (!isArchive) {
            this.archive = new ThornodeService(cachePath, true);
        }
    }

    async getTxStatus(hash: string) {
        if (!hash) {
            throw new Error('No transaction hash');
        }

        if (this.cache.has(hash)) {
            return this.cache.read(hash);
        }

        const response = await this.api.txStatus(hash);
        let tx: TxStatusResponse = response.data;

        // If the transaction data does not exist then fetch it from the archive
        if (!tx.tx && !this.isArchive) {
            tx = await this.archive?.getTxStatus(hash);
        }

        this.cache.write(hash, tx);

        return tx;
    }
}

async function test() {
    const hash = '';
    const thornode = new ThornodeService();
    // thornode.cache.clear(hash);
    const tx = await thornode.getTxStatus(hash);
    console.log(tx);
}

if (require.main === module) {
    console.log('Test: ' + __filename);
    test();
}
