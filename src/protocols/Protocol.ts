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
    midgardUrl: string;
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
    counterparty: 'mayachain',
    nativeChain: 'MAYA',
    // To be confirmed in Summ; it ignores blockchain values it does not recognise
    blockchain: 'MAYAChain',
    nativeAsset: 'MAYA.CACAO',
    nativeAddressPrefix: 'maya1',
    lpTokenPrefix: 'MayaLP',
    midgardUrl: process.env.MAYA_MIDGARD_API_URL || 'https://midgard.mayachain.info',
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
