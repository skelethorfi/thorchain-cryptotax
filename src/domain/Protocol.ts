import {API_URLS} from "../config/apiUrls";

// What differs between THORChain and its fork Maya Protocol when mapping Midgard actions.
// See docs/specs/maya.md.
export type ProtocolId = 'thorchain' | 'maya';

export interface Protocol {
    id: ProtocolId;
    // Counterparty used in the CSV from/to columns
    counterparty: string;
    // Midgard chain id of the native chain, and the blockchain value written to the CSV for it
    nativeChain: string;
    blockchain: string;
    nativeAsset: string;
    nativeAddressPrefix: string;
    lpTokenPrefix: string;
    // Savers positions are not pool LP units, so they get their own token name (docs/specs/savers.md)
    saversTokenPrefix: string;
    // Names synths, which live on this chain but give exposure to another chain's asset:
    // <prefix>Synth.BTC.BTC (docs/specs/assets.md)
    assetNamePrefix: string;
    // Also prefix secured and trade assets (<prefix>Secured.BTC.BTC, <prefix>Trade.BTC.BTC) instead of
    // giving them the L1 asset's name. Set from the config's [assets] table (docs/specs/assets.md).
    prefixSecuredAssets?: boolean;
    prefixTradeAssets?: boolean;
    midgardUrl: string;
    nodeUrl?: string;
    // Fallback inbound gas (base units of the native asset) when THORNode data is missing
    defaultGas?: string;
    // Decimals of an asset's base amounts as reported by this protocol's Midgard
    decimals(asset: string): number;
}

export const THORCHAIN: Protocol = {
    id: 'thorchain',
    counterparty: 'thorchain',
    nativeChain: 'THOR',
    blockchain: 'THORChain',
    nativeAsset: 'THOR.RUNE',
    nativeAddressPrefix: 'thor1',
    lpTokenPrefix: 'ThorLP',
    saversTokenPrefix: 'ThorSavers',
    assetNamePrefix: 'Thor',
    midgardUrl: API_URLS.midgard,
    defaultGas: '2000000',
    decimals: () => 8,
};

// Checked 2026-10-01 against live pool depths: CACAO is 1e10, the MAYA token 1e4, other assets 1e8
const MAYA_DECIMALS: {[asset: string]: number} = {
    'MAYA.CACAO': 10,
    'MAYA.MAYA': 4,
    'MAYA': 4,
};

export const MAYA: Protocol = {
    id: 'maya',
    counterparty: 'mayaprotocol',
    nativeChain: 'MAYA',
    // Summ's name for Maya Protocol. Summ has no Maya Protocol chain to attach a row to (its blockchain
    // list has none), so no value gives these rows a chain today; this one matches Summ's catalogue.
    blockchain: 'Mayachain',
    nativeAsset: 'MAYA.CACAO',
    nativeAddressPrefix: 'maya1',
    lpTokenPrefix: 'MayaLP',
    saversTokenPrefix: 'MayaSavers',
    assetNamePrefix: 'Maya',
    midgardUrl: process.env.MAYA_MIDGARD_API_URL || 'https://midgard.mayachain.info',
    // Mayanode: the native fee setting at a past height (MayanodeService)
    nodeUrl: process.env.MAYANODE_API_URL || 'https://mayanode.mayachain.info',
    // NativeTransactionFee from Mayanode constants and mimir (2026-10-01): 0.2 CACAO
    defaultGas: '2000000000',
    decimals: (asset: string) => MAYA_DECIMALS[asset.toUpperCase()] ?? 8,
};

export const PROTOCOLS: {[id in ProtocolId]: Protocol} = {thorchain: THORCHAIN, maya: MAYA};

export function getProtocol(id: string | undefined): Protocol {
    const protocol = PROTOCOLS[(id ?? 'thorchain') as ProtocolId];

    if (!protocol) {
        throw new Error(`Unknown protocol: ${id}`);
    }

    return protocol;
}

// The blockchain value written to the CSV for a Midgard chain id
export function formatBlockchain(chain: string): string {
    const protocol = Object.values(PROTOCOLS).find(p => p.nativeChain === chain);
    return protocol ? protocol.blockchain : chain;
}

// Options from the config's [assets] table. All optional; the default is the L1 name for both.
export interface AssetNamesConfig {
    prefixSecuredAssets?: boolean;
    prefixTradeAssets?: boolean;
}

export function withAssetNames(protocol: Protocol, assets: AssetNamesConfig = {}): Protocol {
    return {
        ...protocol,
        prefixSecuredAssets: assets.prefixSecuredAssets ?? false,
        prefixTradeAssets: assets.prefixTradeAssets ?? false,
    };
}
