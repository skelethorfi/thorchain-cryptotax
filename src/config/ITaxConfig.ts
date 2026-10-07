import {IWallet} from "./IWallet";
import {AssetNamesConfig, ProtocolId} from "../domain/Protocol";

export interface ITaxConfig {
    fromDate: string;
    toDate: string;
    frequency: 'monthly' | 'yearly' | 'none',
    // The IANA time zone whose calendar days the periods are made of, e.g. "Europe/London": set it to the
    // tax software's timezone (docs/specs/periods.md). Default: UTC
    timezone?: string;
    // No longer used (every run fetches the latest data); a warning is shown if set
    cacheDataSources?: boolean;
    outputPath: string;
    // No longer used (unsupported actions are saved in each run's folder); a warning is shown if set
    unsupportedActionsPath?: string;
    // The record store (docs/specs/snapshots.md). Default: store/ next to the config
    storePath: string;
    // Deprecated name of storePath
    cachePath?: string;
    // Days after its date that a tx still pending counts as stuck: a default run stops fetching it again
    // (docs/specs/snapshots.md). Default: 30
    pendingStuckDays: number;
    wallets: IWallet[];
    // Protocols whose Midgard is queried for every wallet. Default: ["thorchain"]
    protocols?: ProtocolId[];
    // How assets that live on THORChain or Maya are named (docs/specs/assets.md). Default: L1 names
    assets?: AssetNamesConfig;
}
