import {Action} from "@xchainjs/xchain-midgard";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {ViewblockTx} from "./viewblock";
import {getDistributionDate, TcyDistributionItem} from "./tcy/TcyDistributionService";
import {CosmosTx} from "./thorchain/CosmosTxService";
import {getActionDate} from "./thorchain/MidgardUtils";
import {ProtocolId, THORCHAIN} from "../domain/Protocol";
import {midgardActionKey, tcyList, VIEWBLOCK_LIST} from "./store/Sources";

export type BundleSource = 'midgard' | 'viewblock' | 'tcy';

// Everything one action needs to be mapped: the listed item plus the related txs fetched for it.
// The exporter and the fixture tool build bundles the same way (Source.ts); a golden case's
// input.json holds one.
export interface RawBundle {
    source: BundleSource;
    // Protocol of a midgard action; 'thorchain' for viewblock and tcy
    protocol: ProtocolId;
    // The wallet it was listed for
    wallet: string;
    data: Action | ViewblockTx | TcyDistributionItem;
    // The inbound THORNode tx statuses (gas the wallet paid on an L1 chain)
    thornodeTxs: TxStatusResponse[];
    // The Cosmos tx of a contract action
    cosmosTxs: CosmosTx[];
}

export function getBundleDate(bundle: RawBundle): Date {
    switch (bundle.source) {
        case 'midgard':
            return getActionDate(bundle.data as Action);
        case 'viewblock':
            return new Date((bundle.data as ViewblockTx).timestamp);
        case 'tcy':
            return getDistributionDate(bundle.data as TcyDistributionItem);
    }
}

// The store folder name of the bundle's listing, e.g. 'midgard' or 'maya-midgard'
export function getBundleSourceName(bundle: RawBundle): string {
    return bundle.source === 'midgard' && bundle.protocol !== 'thorchain' ? `${bundle.protocol}-midgard` : bundle.source;
}

// The store record a bundle was listed as, e.g. 'midgard/swap.<txid>'. An action listed for two wallets
// is one record, so it has one key.
export function getBundleKey(bundle: RawBundle): string {
    switch (bundle.source) {
        case 'midgard':
            return `${getBundleSourceName(bundle)}/${midgardActionKey(bundle.data as Action)}`;
        case 'viewblock':
            return `viewblock/${VIEWBLOCK_LIST.keyOf(bundle.data as ViewblockTx)}`;
        case 'tcy':
            return `tcy/${tcyList(bundle.wallet).keyOf(bundle.data as TcyDistributionItem)}`;
    }
}

// A Midgard action listed for several wallets (e.g. a swap from one to another) is mapped once, from the
// first wallet's listing; it maps the same whichever wallet listed it. Sends (Midgard and Viewblock) and TCY
// distributions are mapped from the listing wallet's side, so every wallet's copy is kept.
export function dedupeBundles(bundles: RawBundle[]): {bundles: RawBundle[]; duplicates: number} {
    const seen = new Set<string>();
    const unique = bundles.filter(bundle => {
        if (bundle.source !== 'midgard' || isMidgardSend(bundle)) {
            return true;
        }

        const key = getBundleKey(bundle);
        const isNew = !seen.has(key);
        seen.add(key);
        return isNew;
    });

    return {bundles: unique, duplicates: bundles.length - unique.length};
}

// Sends before this come from Viewblock too, as Midgard's history is incomplete (docs/specs/sends.md)
export const VIEWBLOCK_SENDS_BEFORE = '2022-04-01';

// The sends that give rows (docs/specs/sends.md): a THORChain send that is the inbound of another action, on
// THORChain (a swap or TCY unstake sent by MsgSend) or Maya (RUNE sent to a Maya vault), is dropped, as that
// action gives the rows; of Viewblock's txs, only sends from before VIEWBLOCK_SENDS_BEFORE that Midgard does
// not list are kept.
export function selectSends(bundles: RawBundle[]): {bundles: RawBundle[]; dropped: {inbound: number; viewblock: number}} {
    const midgard = bundles.filter(bundle => bundle.source === 'midgard');
    const inboundTxids = (sends: boolean) => new Set(midgard
        .filter(bundle => isMidgardSend(bundle) === sends)
        .flatMap(bundle => (bundle.data as Action).in.map(tx => tx.txID?.toUpperCase()))
        .filter(Boolean));
    const actionInbounds = inboundTxids(false);
    const listed = new Set([...actionInbounds, ...inboundTxids(true)]);
    const cutoff = new Date(`${VIEWBLOCK_SENDS_BEFORE}T00:00:00Z`).getTime();

    const isInbound = (bundle: RawBundle) => bundle.protocol === THORCHAIN.id && isMidgardSend(bundle)
        && actionInbounds.has((bundle.data as Action).in[0]?.txID?.toUpperCase());
    const isViewblockGap = (bundle: RawBundle) => {
        const tx = bundle.data as ViewblockTx;
        return tx.types.includes('send') && tx.timestamp < cutoff && !listed.has(tx.hash.toUpperCase());
    };

    const kept = bundles.filter(bundle => bundle.source === 'viewblock' ? isViewblockGap(bundle) : !isInbound(bundle));

    return {
        bundles: kept,
        dropped: {
            inbound: bundles.filter(isInbound).length,
            viewblock: bundles.filter(bundle => bundle.source === 'viewblock').length - kept.filter(bundle => bundle.source === 'viewblock').length,
        },
    };
}

function isMidgardSend(bundle: RawBundle): boolean {
    return bundle.source === 'midgard' && (bundle.data as Action).type === 'send';
}
