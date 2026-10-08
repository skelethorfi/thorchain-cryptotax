import {Configuration, TransactionsApi, type TxStatusResponse} from "@xchainjs/xchain-thornode";
import {RecordStore} from "../store/RecordStore.ts";
import {THORNODE_RULES} from "../store/Sources.ts";
import {API_URLS} from "../../config/apiUrls.ts";
import {http} from "../http.ts";

// The last block of THORChain v1 (2024-09-04). The current API has no tx status up to it; the v1 API has them from
// the 2022-03-22 migration on, and neither has the ones before.
export const THORNODE_V1_LAST_HEIGHT = 17562001;

export function thornodeUrlFor(height?: number): string {
    return height !== undefined && height <= THORNODE_V1_LAST_HEIGHT ? API_URLS.thornodeArchive : API_URLS.thornode;
}

export class ThornodeService {
    private apis = new Map<string, TransactionsApi>();

    private store: RecordStore;
    private source: string;
    constructor(store: RecordStore = new RecordStore('_cache'), source: string = 'thornode') {
        this.store = store;
        this.source = source;
    }

    // date and height: of the action the tx belongs to; a tx status has no date of its own to be filed by, and the
    // height picks the API that has it
    async getTxStatus(hash: string, date?: Date, height?: number): Promise<TxStatusResponse> {
        if (!hash) {
            throw new Error('No transaction hash');
        }

        return this.store.record(this.source, hash, () => this.fetchTxStatus(hash, height), THORNODE_RULES, date);
    }

    private async fetchTxStatus(hash: string, height?: number) {
        const url = thornodeUrlFor(height);
        let api = this.apis.get(url);

        if (!api) {
            api = new TransactionsApi(new Configuration({basePath: url}), url, http);
            this.apis.set(url, api);
        }

        return {data: (await api.txStatus(hash)).data, url: `${url}/thorchain/tx/status/${hash}`};
    }
}
