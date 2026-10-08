import {IWallet} from "./IWallet";
import {AssetNamesConfig, ProtocolId} from "../domain/Protocol";

export const MAYA_LIQUIDITY_AUCTION = ['income', 'deposit'] as const;
export type MayaLiquidityAuction = typeof MAYA_LIQUIDITY_AUCTION[number];

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
    // Days after its date that an action or tx still pending counts as stuck: a default run stops fetching
    // it again (docs/specs/snapshots.md, docs/specs/pending.md). Default: 30
    pendingStuckDays: number;
    // Days after its date that an action still pending may yet finalise (docs/specs/pending.md). Default: 3
    pendingGraceDays: number;
    wallets: IWallet[];
    // Protocols whose Midgard is queried for every wallet. Default: ["thorchain"]
    protocols?: ProtocolId[];
    // How assets that live on THORChain or Maya are named (docs/specs/assets.md). Default: L1 names
    assets?: AssetNamesConfig;
    // Maya's 2023 liquidity auction (docs/specs/maya.md): 'income' (what the auction supplied is income at its
    // end) or 'deposit' (the position's cost is the RUNE deposited). No default: a run that finds an auction
    // position stops until it is set.
    mayaLiquidityAuction?: MayaLiquidityAuction;
    // Senders whose transfers to the config's wallets are income, e.g. a project's reward distribution wallet
    // (docs/specs/sends.md). Unset: the known distribution wallets' MAYA (KNOWN_DISTRIBUTORS); set, it replaces
    // them, so [] makes every transfer received a receive
    incomeFrom?: string[];
}
