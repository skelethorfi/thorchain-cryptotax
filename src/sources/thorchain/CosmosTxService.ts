import type {Action} from "@xchainjs/xchain-midgard";
import {RecordStore} from "../store/RecordStore.ts";
import {COSMOS_TX_RULES} from "../store/Sources.ts";
import {API_URLS} from "../../config/apiUrls.ts";
import {http} from "../http.ts";

// A THORChain Cosmos tx from THORNode's /cosmos/tx/v1beta1/txs/{hash}, trimmed to what the mappers use.
// It is the only source of what a wasm contract call paid out and of its gas (docs/specs/rujira.md).
export interface CosmosTx {
    txhash: string;
    height: string;
    // Block time; absent from txs stored before it was kept (2026-10-04)
    timestamp?: string;
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
        timestamp: txResponse.timestamp,
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
    private store: RecordStore;
    private source: string;
    constructor(store: RecordStore = new RecordStore('_cache'), source: string = 'thornode-cosmos') {
        this.store = store;
        this.source = source;
    }

    // date: of the action the tx belongs to, for filing a tx stored without its block time
    async getTx(hash: string, date?: Date): Promise<CosmosTx> {
        return this.store.record(this.source, hash, async () => {
            const url = `${API_URLS.thornode}/cosmos/tx/v1beta1/txs/${hash}`;
            const response = await http.get(url);
            return {data: toCosmosTx(response.data), url};
        }, COSMOS_TX_RULES, date);
    }
}
