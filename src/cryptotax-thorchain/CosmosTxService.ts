import axios from "axios";
import {Action} from "@xchainjs/xchain-midgard";
import {RecordRules, RecordStore} from "../cache/RecordStore";
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

// A copy without events (pruned) is not used over one with them
export const COSMOS_TX_RULES: RecordRules<CosmosTx> = {
    completeness: tx => tx.events.length > 0 ? 1 : 0,
};

export class CosmosTxService {
    constructor(private store: RecordStore = new RecordStore('_cache'), private source: string = 'thornode-cosmos') {
    }

    async getTx(hash: string): Promise<CosmosTx> {
        return this.store.record(this.source, hash, async () => {
            const url = `${API_URLS.thornode}/cosmos/tx/v1beta1/txs/${hash}`;
            const response = await axios.get(url);
            return {data: toCosmosTx(response.data), url};
        }, COSMOS_TX_RULES);
    }
}
