import {Action} from "@xchainjs/xchain-midgard";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {ListOptions, monthFolder, RecordRules} from "./RecordStore";
import {ViewblockTx} from "../viewblock/ViewblockTx";
import {TcyDistributionItem} from "../tcy/TcyDistributionService";
import {CosmosTx} from "../thorchain/CosmosTxService";

// How each source's records are keyed, filed and compared in the store (docs/specs/snapshots.md). The
// services and the importer of old caches both use these.


// A Midgard action has no id. Its type and first txid are unique among a wallet's actions, except for
// contract actions: one wasm call gives an action per event, so they add the event. The few with no txid
// (e.g. some refunds) fall back to their date. Old Midgard's genesisTx placeholders all share one txid, so
// they are told apart by pool and depositing addresses.
export function midgardActionKey(action: Action): string {
    const txId = action.in.find(tx => tx.txID)?.txID || action.out.find(tx => tx.txID)?.txID;
    const contractType = (action.metadata as any).contract?.contractType;

    if (isGenesisPlaceholder(action)) {
        return [action.type, 'genesisTx', ...action.pools, action.in.map(tx => tx.address || '-').join('+')].join('.');
    }

    return [action.type, txId || `date-${action.date}`, contractType].filter(Boolean).join('.');
}

// A pending action (e.g. an unfinished loan repayment or refund) can later be finalised
export const MIDGARD_RULES: RecordRules<Action> = {
    isPending: action => action.status !== 'success',
    folderOf: action => monthFolder(new Date(Number(action.date) / 1e6)),
};

// THORNode prunes old txs: a later fetch can lose the tx and its gas, so the copy with more is used.
// A tx still in progress (a stage not completed) can later be finished.
export const THORNODE_RULES: RecordRules<TxStatusResponse> = {
    completeness: tx => (tx.tx ? 1 : 0) + ((tx.tx as any)?.gas?.length ? 1 : 0),
    isPending: tx => Object.values((tx as any).stages ?? {}).some((stage: any) => stage?.completed === false),
    // An outbound never signed (e.g. a switch, which is minted on THORChain) counts the blocks since it was
    // scheduled, which grows on every fetch
    normalise: tx => {
        const outboundSigned = (tx as any).stages?.outbound_signed;

        if (!outboundSigned || !('blocks_since_scheduled' in outboundSigned)) {
            return tx;
        }

        const {blocks_since_scheduled, ...rest} = outboundSigned;
        return {...tx, stages: {...(tx as any).stages, outbound_signed: rest}} as TxStatusResponse;
    },
};

// A copy without events (pruned) is not used over one with them. Filed by its block time; one stored
// before the time was kept takes its action's date.
export const COSMOS_TX_RULES: RecordRules<CosmosTx> = {
    completeness: tx => tx.events.length > 0 ? 1 : 0,
    folderOf: tx => tx.timestamp ? monthFolder(new Date(tx.timestamp)) : undefined,
};

// Viewblock adds each amount's value at today's price (usdNew), which changes on every fetch and would make
// every fetch look like a change in the source data. It is dropped before a tx is stored; the value at
// the time of the tx (usd) is kept.
export function withoutCurrentValues<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map(withoutCurrentValues) as T;
    }

    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value)
            .filter(([key]) => key !== 'usdNew')
            .map(([key, item]) => [key, withoutCurrentValues(item)])) as T;
    }

    return value;
}

export const MIDGARD_LIST: ListOptions<Action> = {keyOf: midgardActionKey, rules: MIDGARD_RULES};

export const VIEWBLOCK_LIST: ListOptions<ViewblockTx> = {
    keyOf: tx => tx.hash,
    rules: {normalise: withoutCurrentValues, folderOf: tx => monthFolder(new Date(Number((tx as any).timestamp)))},
};

// Each TCY distribution is a record, keyed by its wallet and date (one a day): unlike an action or a tx,
// a distribution belongs to one wallet, and several wallets are paid on the same day
export function tcyList(wallet: string): ListOptions<TcyDistributionItem> {
    return {keyOf: item => `${wallet}.${item.date}`, rules: {folderOf: item => monthFolder(new Date(Number(item.date) * 1000))}};
}

// Old Midgard (before its 2022-03-22 store migration) reports LP positions that existed then as adds with
// the txid 'genesisTx'. Midgard's archive (Liquify) has the real adds instead, so importing both would
// count those positions twice.
export function isGenesisPlaceholder(action: Action): boolean {
    return action.in.some(tx => tx.txID === 'genesisTx');
}

export interface ListSource {
    kind: 'list';
    options: (wallet: string) => ListOptions<any>;
    // Left out when importing old caches
    skip?: (item: any) => boolean;
    // An old cache's file name for a wallet, and the items in it, if not the wallet and the list itself
    legacyWallet?: (name: string) => string;
    legacyItems?: (data: any) => any[];
}

// The sources in a store: wallet lists, and records looked up one at a time (a THORNode tx status has no
// date of its own: it is filed by the date of the action it was fetched for)
export const SOURCES: {[source: string]: ListSource | {kind: 'record', rules: RecordRules<any>}} = {
    'midgard': {kind: 'list', options: () => MIDGARD_LIST, skip: isGenesisPlaceholder},
    'maya-midgard': {kind: 'list', options: () => MIDGARD_LIST, skip: isGenesisPlaceholder},
    'viewblock': {kind: 'list', options: () => VIEWBLOCK_LIST},
    'tcy': {
        kind: 'list', options: tcyList,
        legacyWallet: name => name.replace(/^tcy_distribution_/, ''),
        legacyItems: data => data.distributions ?? [],
    },
    'thornode': {kind: 'record', rules: THORNODE_RULES},
    'thornode-cosmos': {kind: 'record', rules: COSMOS_TX_RULES},
};
