import {IWallet} from "./IWallet";
import {AssetNamesConfig, ProtocolId} from "../protocols/Protocol";

export interface ITaxConfig {
    fromDate: string;
    toDate: string;
    frequency: 'monthly' | 'yearly' | 'none',
    // No longer used (every run fetches the latest data); a warning is shown if set
    cacheDataSources?: boolean;
    outputPath: string;
    unsupportedActionsPath: string;
    // The record store (docs/specs/snapshots.md). Default: store/ next to the config
    storePath: string;
    // Deprecated name of storePath
    cachePath?: string;
    wallets: IWallet[];
    // Protocols whose Midgard is queried for every wallet. Default: ["thorchain"]
    protocols?: ProtocolId[];
    // How assets that live on THORChain or Maya are named (docs/specs/assets.md). Default: L1 names
    assets?: AssetNamesConfig;
}
