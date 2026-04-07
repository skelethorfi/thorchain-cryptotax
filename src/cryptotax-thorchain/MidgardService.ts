import {Cache} from "../cache/Cache";
import {Action, Configuration, MidgardApi} from '@xchainjs/xchain-midgard';
import assert from "assert";
import axios from "axios";
import axiosThrottle from 'axios-request-throttle';
import {API_URLS} from "../config/apiUrls";

axiosThrottle.use(axios, { requestsPerSecond: 1 });

// https://github.com/xchainjs/xchainjs-lib/tree/master/packages/xchain-midgard
// midgard api: https://midgard.thorswap.net/v2/doc
// midgard swagger json: https://midgard.thorchain.info/v2/swagger.json

// NOTE:
// can load balance between 2 like web3tax
// MIDGARD_URL_A: "https://midgard.thorchain.info/v2/actions?limit=50&address={WALLETS}&offset={OFFSET}"
// MIDGARD_URL_B: "https://midgard.thorswap.net/v2/actions?limit=50&address={WALLETS}&offset={OFFSET}"

export class MidgardService {
    cache: Cache;
    api: MidgardApi;

    constructor(cachePath: string = '_cache') {
        this.cache = new Cache(cachePath);
        const apiConfig = new Configuration({ basePath: API_URLS.midgard });
        this.api = new MidgardApi(apiConfig);
    }

    async getActions(address: string) {
        console.log(`[Midgard] getActions('${address}')`);

        if (this.cache.has(address)) {
            return this.cache.read(address);
        }

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

        this.cache.write(address, actions);

        return actions;
    }
}

async function test() {
    const address = '';
    const midgard = new MidgardService();
    // midgard.cache.clear(address);
    const actions: Action[] = await midgard.getActions(address);
    console.log(actions.length);
}

if (require.main === module) {
    console.log('Test: ' + __filename);
    test();
}
