import {assetFromStringEx, AssetType} from "@xchainjs/xchain-util";

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

export function parseMidgardAsset(assetStr: string): {
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
    const displayCurrency = asset.type === AssetType.SYNTH ? `${asset.chain}/${ticker}` : ticker;
    // CTC fails to render the ledger view if the currency contains a `/`, so synth
    // currencies need a display form for descriptions and a CTC-safe form for export.
    const currency = asset.type === AssetType.SYNTH ? displayCurrency.replace('/', '.') : ticker;

    return {
        blockchain: asset?.chain,
        currency,
        displayCurrency
    };
}

export function parseMidgardPool(pool: string): string {
    const { blockchain, currency } = parseMidgardAsset(pool);
    return `${blockchain}.${currency}`;
}
