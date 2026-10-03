import {assetFromStringEx, AssetType} from "@xchainjs/xchain-util";
import { Protocol, THORCHAIN } from "../protocols/Protocol";

export function parseMidgardDate(nanoTimestamp: string): Date {
    return new Date(parseInt(nanoTimestamp) / 1000000);
}

export function toMidgardNanoTimestamp(date: Date): string {
    return (date.getTime() * 1000000).toString();
}

function tickerRename(ticker: string) {
    const renames: {[key: string]: string} = {
        'LUNA': 'LUNC',
        'UST': 'USTC'
    };

    return renames[ticker] ?? ticker;
}

// Assets that live on THORChain (or Maya) but represent another chain's asset, by Midgard notation.
// A synth is pool-backed exposure, a different holding: it gets its own name. Trade and secured assets
// are the same asset held 1:1 on THORChain, so they keep the L1 asset's name for now (backlog: export
// moves into and out of them as bridges).
const ASSET_KINDS: {[type: number]: {separator: string; name?: string}} = {
    [AssetType.SYNTH]: {separator: '/', name: 'Synth'},
    [AssetType.TRADE]: {separator: '~'},
    [AssetType.SECURED]: {separator: '-'},
};

// Cosmos denoms on THORChain such as x/ruji parse as a synth of chain X, but are native tokens
const NATIVE_DENOM_CHAIN = 'X';

// currency is what the CSV exports; displayCurrency is for descriptions, in Midgard's notation.
// See docs/specs/assets.md.
export function parseMidgardAsset(assetStr: string, protocol: Protocol = THORCHAIN): {
    blockchain: string;
    currency: string;
    displayCurrency: string;
} {
    let asset;

    try {
        asset = assetFromStringEx(assetStr);
    } catch (e) {
        throw new Error(`Failed to parse asset string: "${assetStr}"`);
    }

    // Update ticker if it has been renamed
    const ticker = tickerRename(asset.ticker);

    if (asset.type === AssetType.SYNTH && asset.chain.toUpperCase() === NATIVE_DENOM_CHAIN) {
        return { blockchain: protocol.nativeChain, currency: ticker, displayCurrency: ticker };
    }

    const kind = ASSET_KINDS[asset.type];

    if (!kind) {
        return { blockchain: asset.chain, currency: ticker, displayCurrency: ticker };
    }

    // e.g. synth BTC/BTC lives on THORChain: ThorSynth.BTC.BTC, so Summ never mixes it with L1 BTC, and
    // without a slash, which breaks Summ's ledger view
    return {
        blockchain: protocol.nativeChain,
        currency: kind.name ? `${protocol.assetNamePrefix}${kind.name}.${asset.chain}.${ticker}` : ticker,
        displayCurrency: `${asset.chain}${kind.separator}${ticker}`,
    };
}

export function parseMidgardPool(pool: string): string {
    const { blockchain, currency } = parseMidgardAsset(pool);
    return `${blockchain}.${currency}`;
}
