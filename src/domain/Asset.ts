import {assetFromStringEx, AssetType} from "@xchainjs/xchain-util";

// Where an asset lives and what it is (docs/specs/assets.md, docs/specs/activity.md):
// native: a chain's own coin or a protocol's token (BTC.BTC, THOR.RUNE, THOR.TCY, x/ruji)
// token: a token on an L1 chain (ETH.USDC-0X…)
// synth, trade, secured: held on THORChain or Maya, for an L1 asset (BTC/BTC, BTC~BTC, BTC-BTC)
export type AssetKind = 'native' | 'token' | 'synth' | 'trade' | 'secured';

export interface Asset {
    // As the source writes it: Midgard notation, or a Cosmos denom (x/ruji). Exporters name it.
    notation: string;
    kind: AssetKind;
}

const KINDS: {[type in AssetType]: AssetKind} = {
    [AssetType.NATIVE]: 'native',
    [AssetType.TOKEN]: 'token',
    [AssetType.SYNTH]: 'synth',
    [AssetType.TRADE]: 'trade',
    [AssetType.SECURED]: 'secured',
};

// Cosmos denoms on THORChain such as x/ruji parse as a synth of chain X, but are native tokens
const NATIVE_DENOM_CHAIN = 'X';

export function toAsset(notation: string): Asset {
    let parsed;

    try {
        parsed = assetFromStringEx(notation);
    } catch (e) {
        throw new Error(`Failed to parse asset string: "${notation}"`);
    }

    const isDenom = parsed.type === AssetType.SYNTH && parsed.chain.toUpperCase() === NATIVE_DENOM_CHAIN;

    return {notation, kind: isDenom ? 'native' : KINDS[parsed.type]};
}
