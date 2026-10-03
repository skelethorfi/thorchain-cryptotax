import {RecordRules, RecordStore} from "../cache/RecordStore";
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

// A Midgard action has no id. Its type, first txid and sub-type are unique among a wallet's actions; the
// few with no txid (e.g. some refunds) fall back to their date.
export function midgardActionKey(action: Action): string {
    const txId = action.in.find(tx => tx.txID)?.txID || action.out.find(tx => tx.txID)?.txID;
    const metadata = action.metadata as any;
    const subType = metadata.contract?.contractType ?? metadata.swap?.txType ?? '';

    return [action.type, txId || `date-${action.date}`, subType].filter(Boolean).join('.');
}

// A pending action (e.g. an unfinished loan repayment or refund) can later be finalised
export const MIDGARD_RULES: RecordRules<Action> = {
    isPending: action => action.status !== 'success',
};

export class MidgardService {
    api: MidgardApi;

    // source: the store folder, e.g. 'midgard' or 'maya-midgard'
    constructor(private store: RecordStore = new RecordStore('_cache'), private source: string = 'midgard',
                private basePath: string = API_URLS.midgard) {
        this.api = new MidgardApi(new Configuration({basePath}));
    }

    async getActions(address: string): Promise<Action[]> {
        console.log(`[Midgard] getActions('${address}')`);

        return this.store.list(this.source, address,
            async () => ({data: await this.fetchActions(address), url: `${this.basePath}/v2/actions?address=${address}`}),
            {keyOf: midgardActionKey, rules: MIDGARD_RULES});
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

async function test() {
    const address = '';
    const midgard = new MidgardService();
    const actions: Action[] = await midgard.getActions(address);
    console.log(actions.length);
}

if (require.main === module) {
    console.log('Test: ' + __filename);
    test();
}
