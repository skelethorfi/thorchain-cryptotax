import {Viewblock} from "../sources/viewblock";
import fs from "fs-extra";
import {format} from 'date-fns-tz';
import {CryptoTaxTransaction, renderRowIds, ROW_IDS_FILE, writeCsv} from "../export/summ/csv";
import {MidgardService} from "../sources/thorchain/MidgardService";
import {ThornodeService} from "../sources/thorchain/ThornodeService";
import {CosmosTxService} from "../sources/thorchain/CosmosTxService";
import {TcyDistributionService} from "../sources/tcy/TcyDistributionService";
import {ITaxConfig} from "../config/ITaxConfig";
import {generateDateRanges} from "../utils/DateRange";
import path from "path";
import {TaxConfig} from "../config/TaxConfig";
import {FetchMode, RecordStore} from "../sources/store/RecordStore";
import {SnapshotManifest} from "../sources/store/SnapshotManifest";
import {getProtocol, Protocol, THORCHAIN, withAssetNames} from "../domain/Protocol";
import {MidgardSource, Source, TcySource, ViewblockSource} from "../sources/Source";
import {ageInDays, NotFinal, PendingAge, pendingAge} from "../sources/Pending";
import {getActionDate} from "../sources/thorchain/MidgardUtils";
import {ACTION_MEMO_WARNING, actionMemoSummary} from "../interpret/midgard/send";
import {knownDistributorReport} from "../export/summ/send";
import {RunSummary} from "./RunSummary";
import {attachAuctionDeposits, dedupeBundles, getBundleKey, getBundleSourceName, RawBundle, selectSends, VIEWBLOCK_SENDS_BEFORE} from "../sources/RawBundle";
import {BundleResult, collectRows, runBundle} from "../pipeline/run";
import {csvFiles} from "../export/summ/files";
import {Action} from "@xchainjs/xchain-midgard";
import {midgardActionKey} from "../sources/store/Sources";

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
    // What the run printed that is worth keeping, written to its folder as summary.md
    report = new RunSummary();
    // Warnings for the end of the run, set by getRows
    endWarnings: string[] = [];
    // Midgard actions whose status is not 'success', filled by the Midgard sources
    notFinal: NotFinal[] = [];
    private readonly today: Date;

    constructor(filename: string, options: ExportOptions = {}) {
        this.today = options.today ?? new Date();
        this.config = TaxConfig.load(filename, this.today);
        const storePath = this.config.storePath;
        this.snapshots = new SnapshotManifest();
        // One store for every source (docs/specs/snapshots.md)
        if (this.config.unsupportedActionsPath !== undefined) {
            this.report.warn('Config: unsupportedActionsPath is no longer used: unsupported actions are saved in each run\'s folder (<run>/unsupported/)');
        }
        if (this.config.cacheDataSources !== undefined) {
            this.report.warn('Config: cacheDataSources is no longer used: every run fetches the latest data and keeps what was stored; use --offline to fetch nothing');
        }
        for (const wallet of this.config.wallets.filter(w => w.addReferencePrices)) {
            this.report.warn(`Config: addReferencePrices is no longer supported and is ignored (wallet ${wallet.name})`);
        }

        const store = new RecordStore(storePath, {
            offline: options.offline,
            fetch: options.fetch,
            replay: options.replay ? SnapshotManifest.load(options.replay) : undefined,
            manifest: this.snapshots,
            pendingStuckDays: this.config.pendingStuckDays,
            today: options.today,
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

    // Each source's bundles for the wallet, in this order: Viewblock (only when the run exports a period
    // before Midgard's send history is complete, docs/specs/sends.md), THORChain Midgard, other protocols'
    // Midgards (e.g. Maya), TCY distributions
    sources(): Source[] {
        return [
            ...(this.config.fromDate < VIEWBLOCK_SENDS_BEFORE ? [new ViewblockSource(this.viewblock)] : []),
            new MidgardSource(this.thorchain, this.midgard, this.thornode, this.cosmosTxs, this.notFinal, this.stuckBefore()),
            ...this.otherMidgards.map(({protocol, midgard}) => new MidgardSource(protocol, midgard, this.thornode, this.cosmosTxs, this.notFinal, this.stuckBefore())),
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
        this.reportNotFinal();
        const unique = dedupeBundles(bundles);
        const sends = selectSends(unique.bundles);
        const auction = attachAuctionDeposits(sends.bundles);

        if (unique.duplicates > 0) {
            this.report.info(`Skipped ${unique.duplicates} Midgard actions also listed for an earlier wallet`);
        }

        if (sends.dropped.inbound > 0) {
            this.report.info(`Skipped ${sends.dropped.inbound} Midgard sends that are another action's inbound`);
        }

        if (sends.dropped.outbound > 0) {
            this.report.info(`Skipped ${sends.dropped.outbound} Midgard sends that are another action's outbound`);
        }

        if (auction.attached > 0) {
            this.report.info(`Attached ${auction.attached} Midgard sends to Maya liquidity auction adds as their deposits`);
        }

        const results = auction.bundles.map(bundle => runBundle(bundle, this.protocolFor(bundle), {assets: this.config.assets, mayaLiquidityAuction: this.config.mayaLiquidityAuction, incomeFrom: this.config.incomeFrom}));
        results.forEach(result => this.handleIssues(result, outputPath));
        const actionMemos = results.flatMap(result => result.issues).filter(issue => issue.message.startsWith(ACTION_MEMO_WARNING)).length;
        this.endWarnings = [actionMemoSummary(actionMemos, this.config.protocols ?? ['thorchain'])].filter((line): line is string => !!line);

        const rows = collectRows(results);
        const distributors = knownDistributorReport(rows, this.config.incomeFrom);
        distributors.info.forEach(line => this.report.info(line));
        this.endWarnings.push(...distributors.warnings);

        return rows;
    }

    // An action still pending from before this date is stuck
    private stuckBefore(): Date {
        return new Date(this.today.getTime() - this.config.pendingStuckDays * 86400_000);
    }

    // Every action that is not final, once, oldest first, with its age and whether it was exported
    // (docs/specs/pending.md)
    private reportNotFinal() {
        const byKey = new Map(this.notFinal.map(item => [item.key, item]));
        const items = [...byKey.values()].sort((a, b) => getActionDate(a.action).getTime() - getActionDate(b.action).getTime());

        if (items.length === 0) {
            return;
        }

        const ages = items.map(item => pendingAge(getActionDate(item.action), this.today, this.config.pendingGraceDays, this.config.pendingStuckDays));

        const count = (age: PendingAge) => ages.filter(a => a === age).length;
        const exported = items.filter(item => item.exported).length;
        const covered = items.filter(item => item.coveredBy).length;
        this.report.info(`Not final: ${items.length} Midgard actions (${count('recent')} recent, ${count('waiting')} waiting, ${count('stuck')} stuck); ${exported} exported, ${covered} covered by a successful action, ${items.length - exported - covered} not exported`);

        items.forEach((item, i) => {
            const {action} = item;
            const date = getActionDate(action);
            const txType = (action.metadata?.swap as any)?.txType;
            const type = txType ? `${action.type} (${txType})` : action.type;
            const days = Math.floor(ageInDays(date, this.today));
            this.report.issue('notFinal', `${date.toISOString()} ${type}: ${action.status}, ${days} days old, ${ages[i]}; ${item.coveredBy ? `covered by ${item.coveredBy}` : item.exported ? 'exported' : 'not exported'}`, item.key);
        });
    }

    // Unsupported actions are saved for triage and failures with their error, both in the run's folder; those, warnings and
    // actions to enter by hand are logged
    private handleIssues({bundle, time, rows, issues}: BundleResult, outputPath: string) {
        const date = time.toISOString();
        const type = bundle.source === 'midgard' ? (bundle.data as Action).type : bundle.source;

        if (bundle.source === 'midgard' && !issues.some(issue => ['unsupported', 'failed', 'ignored'].includes(issue.kind))) {
            console.log(`${date} ${type}: ${rows.length}`);
        }

        const key = getBundleKey(bundle);

        for (const issue of issues) {
            if (issue.kind === 'warning' || issue.kind === 'manual') {
                this.report.issue(issue.kind, `${date} ${type}: ${issue.kind === 'manual' ? 'enter by hand: ' : ''}${issue.message}`, key);
            } else if (issue.kind === 'unsupported') {
                this.report.issue('unsupported', `${date} ${type}: unsupported action`, key);
                this.saveUnsupported(bundle, outputPath);
            } else if (issue.kind === 'failed') {
                this.report.issue('failed', `${date} ${type}: ${issue.message}`, key);
                this.saveFailure(outputPath, bundle.wallet, getBundleSourceName(bundle), time, bundle.data, issue.message);
            }
        }
    }

    // In the run's folder, so it lists only what this run could not map
    private saveUnsupported(bundle: RawBundle, outputPath: string) {
        const filePath = path.join(outputPath, 'unsupported', unsupportedActionFile(bundle));
        fs.outputFileSync(filePath, JSON.stringify(bundle.data, null, 4));
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
        const {files, exported, warnings} = csvFiles(txs, ranges, this.config.wallets, this.config.timezone);
        warnings.forEach(warning => this.report.warn(`WARN: ${warning}`));
        files.forEach(file => writeCsv(path.join(outputPath, file.name), file.rows));
        // Next to csv/, so it is not uploaded: it names wallets and records
        fs.outputFileSync(path.join(path.dirname(outputPath), ROW_IDS_FILE), renderRowIds(files[0].rows));
        this.report.info(`Total exported: ${exported}`);
    }

    private saveFailure(outputPath: string, walletAddress: string, source: string, date: Date, data: any, errorMessage: string): void {
        const failureDir = path.join(outputPath, 'failures', walletAddress, source);
        fs.ensureDirSync(failureDir);
        const timestamp = format(date, 'yyyy-MM-dd_HHmm_ssSSS');
        fs.writeJsonSync(path.join(failureDir, `${timestamp}.json`), { ERROR_MESSAGE: errorMessage, ...data }, { spaces: 4});
    }
}

// Where an unsupported Midgard action is saved, under <run>/unsupported/: [<protocol>/]<type>/<record key>.json.
// The record key (midgardActionKey) is unique per action, so the several contract actions of one tx each get a
// file; a '/' in a contract type becomes '_'.
export function unsupportedActionFile(bundle: RawBundle): string {
    const action = bundle.data as Action;
    const protocolDir = bundle.protocol === THORCHAIN.id ? '' : bundle.protocol;
    return path.join(protocolDir, action.type, midgardActionKey(action).replace(/[\\/:*?"<>|]/g, '_') + '.json');
}
