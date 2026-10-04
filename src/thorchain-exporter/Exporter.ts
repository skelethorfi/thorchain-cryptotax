import {Viewblock} from "../viewblock";
import fs from "fs-extra";
import {format} from 'date-fns-tz';
import {CryptoTaxTransaction, writeCsv} from "../cryptotax";
import {MidgardService} from "../cryptotax-thorchain/MidgardService";
import {ThornodeService} from "../cryptotax-thorchain/ThornodeService";
import {CosmosTxService, getCosmosTxIds} from "../cryptotax-thorchain/CosmosTxService";
import {TcyDistributionService} from "../cryptotax-thorchain/TcyDistributionService";
import {Action, ActionStatusEnum, ActionTypeEnum} from "@xchainjs/xchain-midgard";
import {ITaxConfig} from "./ITaxConfig";
import {IWallet} from "./IWallet";
import {TaxEvents} from "./TaxEvents";
import {DateRange, generateDateRanges} from "../utils/DateRange";
import path from "path";
import {BaseMapper} from "./BaseMapper";
import {getActionDate} from "../cryptotax-thorchain/MidgardActionMapper";
import {TaxConfig} from "./TaxConfig";
import {TcyDistributionMapper} from "../cryptotax-thorchain/TcyDistributionMapper";
import {FetchMode, RecordStore} from "../cache/RecordStore";
import {SnapshotManifest} from "../cache/SnapshotManifest";
import {getProtocol, Protocol, THORCHAIN, withAssetNames} from "../protocols/Protocol";
import {assetFromStringEx, AssetType} from "@xchainjs/xchain-util";

// The inbound txids to look up on THORNode, which is the only source of the gas the wallet paid on an
// L1 chain (docs/specs/fees.md). A refund's is looked up to see what the wallet sent, not for its gas.
export function getThornodeTxIds(action: Action): string[] {
    const inbounds = action.in ?? [];
    let txIds: (string | undefined)[] = [];

    if (action.type === ActionTypeEnum.Swap || action.type === ActionTypeEnum.Switch || action.type === ActionTypeEnum.Refund) {
        txIds = [inbounds[0]?.txID];
    } else if (action.type === ActionTypeEnum.AddLiquidity || action.type === ActionTypeEnum.Withdraw) {
        // Deposits and withdrawal requests sent on THORChain pay the native fee, so only L1 ones are looked up
        txIds = inbounds.filter(inbound => isL1Asset(inbound.coins[0]?.asset)).map(inbound => inbound.txID);
    }

    // Old Midgard reports LP positions from before its start with the placeholder txid 'genesisTx'
    return [...new Set(txIds.filter((txId): txId is string => !!txId && txId !== 'genesisTx'))];
}

function isL1Asset(asset?: string): boolean {
    if (!asset) {
        return false;
    }

    const {chain, type} = assetFromStringEx(asset);

    return chain !== 'THOR' && type === AssetType.NATIVE;
}

export function shouldIncludeAction(action: Action): boolean {
    if (action.status === ActionStatusEnum.Success) {
        return true;
    }

    const txType = (action.metadata.swap as any)?.txType;

    // Loan repayments show as 'pending' if the loan is not closed
    if (txType === 'loanRepayment') {
        return true;
    }

    // A loan open with an output was paid out, whatever its status. Midgard reports loan opens that
    // borrowed RUNE as 'pending' (the RUNE payout has no txid). See docs/specs/loans.md.
    if (txType === 'loanOpen') {
        return action.out.some(out => out.coins.length > 0);
    }

    return false;
}

export interface ExportOptions {
    // Only read cached snapshots; fail on anything not cached
    offline?: boolean;
    // 'latest' (default: wallet lists and pending records) or 'all' (every record again)
    fetch?: FetchMode;
    // A run folder (or its snapshots.json) whose exact records to read
    replay?: string;
}

export class Exporter {
    config: ITaxConfig;
    // The snapshots this run used
    snapshots: SnapshotManifest;
    viewblock: Viewblock;
    midgard: MidgardService;
    // Midgard of each other protocol enabled in the config (e.g. Maya)
    thorchain: Protocol;
    otherMidgards: {protocol: Protocol, midgard: MidgardService}[];
    thornode: ThornodeService;
    cosmosTxs: CosmosTxService;
    tcyDistribution: TcyDistributionService;

    constructor(filename: string, options: ExportOptions = {}) {
        this.config = TaxConfig.load(filename);
        const storePath = this.config.storePath;
        this.snapshots = new SnapshotManifest();
        // One store for every source (docs/specs/snapshots.md)
        if (this.config.cacheDataSources !== undefined) {
            console.warn('Config: cacheDataSources is no longer used: every run fetches the latest data and keeps what was stored; use --offline to fetch nothing');
        }

        const store = new RecordStore(storePath, {
            offline: options.offline,
            fetch: options.fetch,
            replay: options.replay ? SnapshotManifest.load(options.replay) : undefined,
            manifest: this.snapshots,
        });
        this.viewblock = new Viewblock(store);
        this.midgard = new MidgardService(store);
        this.thornode = new ThornodeService(store);
        this.cosmosTxs = new CosmosTxService(store);
        this.tcyDistribution = new TcyDistributionService(store);
        this.thorchain = withAssetNames(THORCHAIN, this.config.assets);
        this.otherMidgards = (this.config.protocols ?? ['thorchain'])
            .map(id => withAssetNames(getProtocol(id), this.config.assets))
            .filter(protocol => protocol.id !== THORCHAIN.id)
            .map(protocol => ({
                protocol,
                midgard: new MidgardService(store, `${protocol.id}-midgard`, protocol.midgardUrl),
            }));
    }

    async getEvents(wallet: IWallet, outputPath: string): Promise<TaxEvents> {
        const events = new TaxEvents();

        const txs = await this.viewblock.getAllTxs({
            address: wallet.address,
            network: 'mainnet'
            // type: 'all',
        });

        for (const tx of txs) {
            try {
                events.addViewblock(tx, wallet, this.config);
            } catch (error) {
                // Log the error, save a copy of failed transaction and keep going
                console.error(error);
                const mapper = new BaseMapper(tx, wallet.address);
                this.saveFailure(outputPath, wallet.address, 'viewblock', mapper.datetime, tx, error);
            }
        }

        // Get Midgard actions
        let actions: Action[] = await this.midgard.getActions(wallet.address);

        actions = this.excludeNonSuccess(actions);

        for (const action of actions) {
            const thornodeTxs = [];

            // The inbound THORNode transactions give the gas the wallet paid
            for (const txId of getThornodeTxIds(action)) {
                thornodeTxs.push(await this.thornode.getTxStatus(txId, getActionDate(action)));
            }

            // A contract action's results are only in its Cosmos tx
            const cosmosTxs = [];

            for (const txId of getCosmosTxIds(action)) {
                cosmosTxs.push(await this.cosmosTxs.getTx(txId, getActionDate(action)));
            }

            try {
                events.addMidgard(action, wallet, thornodeTxs, this.config, this.thorchain, cosmosTxs);
            } catch (error) {
                // Log the error, save a copy of failed transaction and keep going
                console.error(error);
                this.saveFailure(outputPath, wallet.address, 'midgard', getActionDate(action), action, error);
            }
        }

        // Get actions from other protocols' Midgards (e.g. Maya), for every wallet
        for (const {protocol, midgard} of this.otherMidgards) {
            const protocolActions = this.excludeNonSuccess(await midgard.getActions(wallet.address));

            for (const action of protocolActions) {
                try {
                    events.addMidgard(action, wallet, [], this.config, protocol);
                } catch (error) {
                    console.error(error);
                    this.saveFailure(outputPath, wallet.address, `${protocol.id}-midgard`, getActionDate(action), action, error);
                }
            }
        }

        // Get TCY distributions
        if (this.isThorchain(wallet.address)) {
            const tcyDistribution = await this.tcyDistribution.getTcyDistribution(wallet.address);
            const distributions = tcyDistribution.distributions || [];

            for (const item of distributions) {
                try {
                    events.addTcyDistribution(item, wallet, this.config);
                } catch (error) {
                    // Log the error, save a copy of failed transaction and keep going
                    console.error(error);
                    this.saveFailure(outputPath, wallet.address, 'tcy', TcyDistributionMapper.parseDate(item), item, error);
                }
            }
        }

        return events;
    }

    excludeNonSuccess(actions: Action[]): Action[] {
        return actions.filter(shouldIncludeAction);
    }

    saveToCsv(txs: CryptoTaxTransaction[], outputPath: string) {
        let expectedExportCount =  0;
        let count = 0;
        const walletExchanges = this.getUniqueWalletExchanges(txs);

        // Output all fetched txs in a single CSV
        writeCsv(path.join(outputPath, 'all.csv'), txs);

        const ranges = generateDateRanges(this.config.fromDate, this.config.toDate, this.config.frequency);

        for (const range of ranges) {
            const rangeTxs = this.getTxsInRange(txs, range);
            expectedExportCount += rangeTxs.length;

            // Output all txs in each range to CSV
            const fn1 = `all-${range.from}_${range.to}.csv`;

            writeCsv(path.join(outputPath, fn1), rangeTxs);

            // If no txs in the current range then skip
            if (rangeTxs.length === 0) {
                continue;
            }

            for (const walletExchange of walletExchanges) {
                const walletTxs = this.getTxsForWallet(rangeTxs, walletExchange);

                if (walletTxs.length) {
                    if (walletExchange === 'thorchain') {
                        // validate txs
                        const badTxs = walletTxs.filter(tx => tx.from !== 'thorchain' && tx.to !== 'thorchain');
                        if (badTxs.length > 0) {
                            console.error(badTxs);
                            throw new Error('bad txs');
                        }

                        const fn2 = `${range.from}_${range.to}_THOR_thorchain_swaps.csv`;

                        writeCsv(path.join(outputPath, fn2), walletTxs);

                        count += walletTxs.length;

                    } else {
                        const fn3 = this.makeFilename(walletExchange, range) + '.csv';

                        writeCsv(path.join(outputPath, fn3), walletTxs);

                        count += walletTxs.length;
                    }
                }
            }
        }

        console.log(`Total exported: ${count}`);

        if (count !== expectedExportCount) {
            throw new Error(`failed to export all txs. expected ${expectedExportCount}`);
        }
    }

    private getTxsForWallet(monthTxs: CryptoTaxTransaction[], walletExchange: string) {
        return monthTxs.filter(tx => tx.walletExchange === walletExchange);
    }

    private getTxsInRange(txs: CryptoTaxTransaction[], range: DateRange) {
        return txs.filter((tx) => {
            const txDate = new Date((tx.timestamp as string).split(' ')[0].split('/').reverse().join('-'));

            if (isNaN((txDate as any))) {
                console.log(tx);
                throw new Error('invalid date');
            }

            return txDate >= new Date(range.from) && txDate <= new Date(range.to);
        });
    }

    private getUniqueWalletExchanges(txs: CryptoTaxTransaction[]): Set<string> {
        return new Set(txs.map((tx) => {
            if (!tx.walletExchange) {
                console.warn(`WARN: missing walletExchange`);
                console.log(tx);
                return 'MISSING-ADDRESS';
            }

            return tx.walletExchange;
        }));
    }

    private findWalletByAddress(address: string) {
        return this.config.wallets.find(wallet => wallet.address.toLowerCase() === address.toLowerCase());
    }

    private makeFilename(walletExchange: string, range: DateRange) {
        const wallet = this.findWalletByAddress(walletExchange);

        if (!wallet) {
            console.warn(`wallet not found in config: ${walletExchange}`);
            return `${range.from}_${range.to}_${walletExchange}`;
        }

        return `${range.from}_${range.to}_${wallet.blockchain}_${this.shortenAddress(wallet.address)}_${wallet.name}`;
    }

    // Returns last 5 characters of address
    private shortenAddress(address: string): string {
        return address.slice(-5);
    }

    private saveFailure(outputPath: string, walletAddress: string, source: string, date: Date, data: any, error: any): void {
        const failureDir = path.join(outputPath, 'failures', walletAddress, source);
        fs.ensureDirSync(failureDir);
        const timestamp = format(date, 'yyyy-MM-dd_HHmm_ssSSS');
        const errorMessage = error.message || 'unknown error';
        fs.writeJsonSync(path.join(failureDir, `${timestamp}.json`), { ERROR_MESSAGE: errorMessage, ...data }, { spaces: 4});
    }

    private isThorchain(wallet: string): boolean {
        return wallet.toLowerCase().startsWith('thor1');
    }
}
