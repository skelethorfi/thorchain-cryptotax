import {RecordStore} from "../store/RecordStore.ts";
import {MIDGARD_LIST} from "../store/Sources.ts";
import {type Action, Configuration, DefaultApi} from '@xchainjs/xchain-midgard';
import assert from "assert";
import {API_URLS} from "../../config/apiUrls.ts";
import {http} from "../http.ts";

// https://github.com/xchainjs/xchainjs-lib/tree/master/packages/xchain-midgard
// midgard api: https://midgard.thorswap.net/v2/doc
// midgard swagger json: https://midgard.thorchain.info/v2/swagger.json (a copy: docs/reference/midgard-api-2.32.9.json)

// NOTE:
// can load balance between 2 like web3tax
// MIDGARD_URL_A: "https://midgard.thorchain.info/v2/actions?limit=50&address={WALLETS}&offset={OFFSET}"
// MIDGARD_URL_B: "https://midgard.thorswap.net/v2/actions?limit=50&address={WALLETS}&offset={OFFSET}"

export class MidgardService {
    api: DefaultApi;

    // source: the store folder, e.g. 'midgard' or 'maya-midgard'
    private store: RecordStore;
    private source: string;
    private basePath: string;
    constructor(store: RecordStore = new RecordStore('_cache'), source: string = 'midgard',
                basePath: string = API_URLS.midgard) {
        this.store = store;
        this.source = source;
        this.basePath = basePath;
        this.api = new DefaultApi(new Configuration({basePath}), basePath, http);
    }

    async getActions(address: string): Promise<Action[]> {
        console.log(`[Midgard] getActions('${address}')`);

        return this.store.list(this.source, address,
            async () => ({data: await this.fetchActions(address), url: `${this.basePath}/v2/actions?address=${address}`}),
            MIDGARD_LIST);
    }

    private async fetchActions(address: string): Promise<Action[]> {
        let actions: Action[] = [];
        let count: number = 0;

        for (let page = 0; page <= 100; page++) {
            const response = await this.api.getActions(address, undefined, undefined, undefined, undefined, undefined, 50, page * 50);
            count = parseInt(response.data.count || '0');

            console.log(`[Midgard] Total actions: ${count}`);
            console.log('page:', page)
            console.log('actions:', response.data.actions.length);

            if (count === 0) {
                break;
            }

            actions = actions.concat(response.data.actions);

            console.log(new Date(parseInt(response.data.actions[0].date) / 1000000));

            if (response.data.actions.length < 50) {
                break
            }
        }

        assert.equal(actions.length, count);

        return actions;
    }
}
