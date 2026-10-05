import {Viewblock} from "../viewblock";
import fs from "fs-extra";
import {format} from 'date-fns-tz';
import {CryptoTaxTransaction, writeCsv} from "../cryptotax";
import {MidgardService} from "../cryptotax-thorchain/MidgardService";
import {ThornodeService} from "../cryptotax-thorchain/ThornodeService";
import {CosmosTxService} from "../cryptotax-thorchain/CosmosTxService";
import {TcyDistributionService} from "../cryptotax-thorchain/TcyDistributionService";
import {ITaxConfig} from "./ITaxConfig";
import {generateDateRanges} from "../utils/DateRange";
import path from "path";
import {TaxConfig} from "./TaxConfig";
import {FetchMode, RecordStore} from "../cache/RecordStore";
import {SnapshotManifest} from "../cache/SnapshotManifest";
import {getProtocol, Protocol, THORCHAIN, withAssetNames} from "../protocols/Protocol";
import {MidgardSource, Source, TcySource, ViewblockSource} from "../sources/Source";
import {dedupeBundles, getBundleSourceName, RawBundle} from "../sources/RawBundle";
import {BundleResult, collectRows, runBundle} from "../pipeline/run";
import {csvFiles} from "../export/summ/files";
import {Action} from "@xchainjs/xchain-midgard";

export interface ExportOptions {
    // Only read cached snapshots; fail on anything not cached
    offline?: boolean;
    // 'latest' (default: wallet lists and pending records) or 'all' (every record again)
    fetch?: FetchMode;
    // A run folder (or its snapshots.json) whose exact records to read
    replay?: string;
    // The run's date: the default toDate. Default: now
    today?: Date;
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
        this.config = TaxConfig.load(filename, options.today ?? new Date());
        const storePath = this.config.storePath;
        this.snapshots = new SnapshotManifest();
        // One store for every source (docs/specs/snapshots.md)
        if (this.config.cacheDataSources !== undefined) {
            console.warn('Config: cacheDataSources is no longer used: every run fetches the latest data and keeps what was stored; use --offline to fetch nothing');
        }
        for (const wallet of this.config.wallets.filter(w => w.addReferencePrices)) {
            console.warn(`Config: addReferencePrices is no longer supported and is ignored (wallet ${wallet.name})`);
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

    // Each source's bundles for the wallet, in this order: Viewblock sends, THORChain Midgard, other
    // protocols' Midgards (e.g. Maya), TCY distributions
    sources(): Source[] {
        return [
            new ViewblockSource(this.viewblock),
            new MidgardSource(this.thorchain, this.midgard, this.thornode, this.cosmosTxs),
            ...this.otherMidgards.map(({protocol, midgard}) => new MidgardSource(protocol, midgard, this.thornode, this.cosmosTxs)),
            new TcySource(this.tcyDistribution),
        ];
    }

    // Every wallet's bundles, wallet by wallet in config order
    async collectBundles(): Promise<RawBundle[]> {
        const bundles: RawBundle[] = [];

        for (const wallet of this.config.wallets) {
            for (const source of this.sources()) {
                bundles.push(...await source.bundlesFor(wallet.address));
            }
        }

        return bundles;
    }

    // Every row of the bundles; issues are logged, and unsupported and failed actions saved
    getRows(bundles: RawBundle[], outputPath: string): CryptoTaxTransaction[] {
        const unique = dedupeBundles(bundles);

        if (unique.duplicates > 0) {
            console.log(`Skipped ${unique.duplicates} Midgard actions also listed for an earlier wallet`);
        }

        const results = unique.bundles.map(bundle => runBundle(bundle, this.protocolFor(bundle), {assets: this.config.assets}));
        results.forEach(result => this.handleIssues(result, outputPath));

        return collectRows(results);
    }

    // Unsupported actions are saved for triage and failures with their error; those, warnings and
    // actions to enter by hand are logged
    private handleIssues({bundle, time, rows, issues}: BundleResult, outputPath: string) {
        const date = time.toISOString();
        const type = bundle.source === 'midgard' ? (bundle.data as Action).type : bundle.source;

        if (bundle.source === 'midgard' && !issues.some(issue => ['unsupported', 'failed', 'ignored'].includes(issue.kind))) {
            console.log(`${date} ${type}: ${rows.length}`);
        }

        for (const issue of issues) {
            if (issue.kind === 'warning' || issue.kind === 'manual') {
                console.warn(`${date} ${type}: ${issue.kind === 'manual' ? 'enter by hand: ' : ''}${issue.message}`);
            } else if (issue.kind === 'unsupported') {
                console.error(`${date} ${type}: unsupported action`);
                this.saveUnsupported(bundle, time);
            } else if (issue.kind === 'failed') {
                console.error(`${date} ${type}: ${issue.message}`);
                this.saveFailure(outputPath, bundle.wallet, getBundleSourceName(bundle), time, bundle.data, issue.message);
            }
        }
    }

    private saveUnsupported(bundle: RawBundle, date: Date) {
        const action = bundle.data as Action;
        const txId = action.in?.[0]?.txID;
        const filename = (txId ? txId : date.toISOString()) + '.json';
        const protocolDir = bundle.protocol === THORCHAIN.id ? '' : bundle.protocol;
        const filePath = path.join(this.config.unsupportedActionsPath, protocolDir, action.type, filename);
        fs.outputFileSync(filePath, JSON.stringify(action, null, 4));
    }

    // Midgard actions are mapped with their protocol's asset-name settings; Viewblock sends and TCY
    // distributions with THORChain's defaults
    private protocolFor(bundle: RawBundle): Protocol {
        if (bundle.source !== 'midgard') {
            return THORCHAIN;
        }

        return [{protocol: this.thorchain}, ...this.otherMidgards].find(({protocol}) => protocol.id === bundle.protocol)!.protocol;
    }

    // Writes the CSV files that csvFiles lays out
    saveToCsv(txs: CryptoTaxTransaction[], outputPath: string) {
        const ranges = generateDateRanges(this.config.fromDate, this.config.toDate, this.config.frequency);
        const {files, exported, warnings} = csvFiles(txs, ranges, this.config.wallets);
        warnings.forEach(warning => console.warn(`WARN: ${warning}`));
        files.forEach(file => writeCsv(path.join(outputPath, file.name), file.rows));
        console.log(`Total exported: ${exported}`);
    }

    private saveFailure(outputPath: string, walletAddress: string, source: string, date: Date, data: any, errorMessage: string): void {
        const failureDir = path.join(outputPath, 'failures', walletAddress, source);
        fs.ensureDirSync(failureDir);
        const timestamp = format(date, 'yyyy-MM-dd_HHmm_ssSSS');
        fs.writeJsonSync(path.join(failureDir, `${timestamp}.json`), { ERROR_MESSAGE: errorMessage, ...data }, { spaces: 4});
    }
}
