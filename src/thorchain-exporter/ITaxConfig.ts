import {IWallet} from "./IWallet";
import {ProtocolId} from "../protocols/Protocol";

export interface ITaxConfig {
    fromDate: string;
    toDate: string;
    frequency: 'monthly' | 'yearly' | 'none',
    cacheDataSources: boolean;
    outputPath: string;
    unsupportedActionsPath: string;
    cachePath: string;
    wallets: IWallet[];
    // Protocols whose Midgard is queried for every wallet. Default: ["thorchain"]
    protocols?: ProtocolId[];
}
