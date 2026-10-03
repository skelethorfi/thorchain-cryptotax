import axios from "axios";
import {Action} from "@xchainjs/xchain-midgard";
import {Cache, CacheOptions} from "../cache/Cache";
import {API_URLS} from "../config/apiUrls";

// A THORChain Cosmos tx from THORNode's /cosmos/tx/v1beta1/txs/{hash}, trimmed to what the mappers use.
// It is the only source of what a wasm contract call paid out and of its gas (docs/specs/rujira.md).
export interface CosmosTx {
    txhash: string;
    height: string;
    code: number;
    fee: CosmosCoin[];
    events: CosmosEvent[];
}

export interface CosmosCoin {
    denom: string;
    amount: string;
}

export interface CosmosEvent {
    type: string;
    attributes: {key: string; value: string}[];
}

// Contract actions are wasm calls, whose results Midgard does not report
export function getCosmosTxIds(action: Action): string[] {
    const txId = action.in?.[0]?.txID;
    return (action.type as string) === 'contract' && txId ? [txId] : [];
}

export function toCosmosTx(response: any): CosmosTx {
    const txResponse = response.tx_response;

    return {
        txhash: txResponse.txhash,
        height: txResponse.height,
        code: txResponse.code,
        fee: response.tx?.auth_info?.fee?.amount ?? [],
        // 'tx' events hold the signature and account sequence, which mappers don't use
        events: txResponse.events.filter((event: any) => event.type !== 'tx').map((event: any) => ({
            type: event.type,
            attributes: event.attributes.map(({key, value}: any) => ({key, value})),
        })),
    };
}

export class CosmosTxService {
    cache: Cache;

    constructor(cachePath: string = '_cache', cacheOptions: CacheOptions = {}) {
        this.cache = new Cache(cachePath, cacheOptions);
    }

    async getTx(hash: string): Promise<CosmosTx> {
        if (this.cache.has(hash)) {
            return this.cache.read(hash);
        }

        this.cache.assertCanFetch(hash);

        const response = await axios.get(`${API_URLS.thornode}/cosmos/tx/v1beta1/txs/${hash}`);
        const tx = toCosmosTx(response.data);

        this.cache.write(hash, tx);

        return tx;
    }
}
