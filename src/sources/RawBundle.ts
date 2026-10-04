import {Action} from "@xchainjs/xchain-midgard";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {ViewblockTx} from "../viewblock";
import {TcyDistributionItem} from "../cryptotax-thorchain/TcyDistributionService";
import {CosmosTx} from "../cryptotax-thorchain/CosmosTxService";
import {getActionDate} from "../cryptotax-thorchain/MidgardUtils";
import {TcyDistributionMapper} from "../cryptotax-thorchain/TcyDistributionMapper";
import {BaseMapper} from "../thorchain-exporter/BaseMapper";
import {ProtocolId} from "../protocols/Protocol";

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
            return new BaseMapper(bundle.data as ViewblockTx, bundle.wallet).datetime;
        case 'tcy':
            return TcyDistributionMapper.parseDate(bundle.data as TcyDistributionItem);
    }
}

// The store folder name of the bundle's listing, e.g. 'midgard' or 'maya-midgard'
export function getBundleSourceName(bundle: RawBundle): string {
    return bundle.source === 'midgard' && bundle.protocol !== 'thorchain' ? `${bundle.protocol}-midgard` : bundle.source;
}
