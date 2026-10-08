import fs from "fs-extra";
import path from "path";
import YAML from "yaml";
import {Action} from "@xchainjs/xchain-midgard";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {CryptoTaxTransaction} from "../export/summ/csv";
import {ViewblockTx} from "../sources/viewblock";
import {runBundle} from "../pipeline/run";
import {Treatment} from "../export/summ";
import {TcyDistributionItem} from "../sources/tcy/TcyDistributionService";
import {getProtocol, ProtocolId} from "../domain/Protocol";
import {CosmosTx} from "../sources/thorchain/CosmosTxService";
import {BundleSource, RawBundle} from "../sources/RawBundle";
import {Activity} from "../domain/Activity";
import {formatAmount} from "../domain/Amount";

// A golden test case is a folder containing:
//   input.json    - the raw source data (a GoldenCaseInput: a RawBundle plus a description)
//   activity.yaml - the activities an interpreter makes from it, reviewed by hand; only for action
//                   types ported to activities (docs/specs/activity.md)
//   expected.yaml - the CSV rows the exporter should produce, reviewed by hand;
//                   one YAML document per row, separated by '---' ('[]' for no rows)
// Inputs must never contain anyone's own wallets or txids (see docs/specs/fixtures.md).

export type GoldenCaseSource = BundleSource;

export interface GoldenCaseInput {
    description: string;
    source: GoldenCaseSource;
    // Protocol of a midgard case. Default: thorchain
    protocol?: ProtocolId;
    // The wallet being exported. Required for viewblock and tcy, which map relative to a wallet.
    wallet: string;
    data: Action | ViewblockTx | TcyDistributionItem;
    // Related THORNode transactions (midgard swaps and switches)
    thornodeTxs?: TxStatusResponse[];
    // The Cosmos tx of a contract action
    cosmosTxs?: CosmosTx[];
    // THORChain sends attached as the action's inbounds (a Maya liquidity auction's deposits)
    inbounds?: Action[];
    // The native fee at the action's height (Maya), base units
    nativeFee?: string;
    // The config's treatment choices the case is mapped with, e.g. {mayaLiquidityAuction: 'income'}
    treatment?: Treatment;
}

export const INPUT_FILE = 'input.json';
export const EXPECTED_FILE = 'expected.yaml';
export const ACTIVITY_FILE = 'activity.yaml';

export function findCaseDirs(root: string): string[] {
    if (!fs.existsSync(root)) {
        return [];
    }

    const dirs: string[] = [];

    for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
        if (!entry.isDirectory()) {
            continue;
        }

        const dir = path.join(root, entry.name);

        if (fs.existsSync(path.join(dir, INPUT_FILE))) {
            dirs.push(dir);
        } else {
            dirs.push(...findCaseDirs(dir));
        }
    }

    return dirs.sort();
}

export function readCaseInput(dir: string): GoldenCaseInput {
    return fs.readJSONSync(path.join(dir, INPUT_FILE));
}

export function readCaseExpected(dir: string): object[] | undefined {
    const file = path.join(dir, EXPECTED_FILE);
    return fs.existsSync(file) ? parseRows(fs.readFileSync(file, 'utf8')) : undefined;
}

export function readCaseActivities(dir: string): object[] | undefined {
    const file = path.join(dir, ACTIVITY_FILE);
    return fs.existsSync(file) ? parseRows(fs.readFileSync(file, 'utf8')) : undefined;
}

export function parseRows(text: string): any[] {
    const docs = YAML.parseAllDocuments(text).map(doc => {
        if (doc.errors.length > 0) {
            throw doc.errors[0];
        }
        return doc.toJS();
    });

    // A single '[]' document means no rows
    return docs.length === 1 && Array.isArray(docs[0]) ? docs[0] : docs;
}

// One document per row. Strings that look like numbers (e.g. amounts) are quoted,
// so they parse back as strings.
export function formatRows(rows: object[]): string {
    if (rows.length === 0) {
        return '[]\n';
    }

    return rows.map(row => YAML.stringify(row, {lineWidth: 0, aliasDuplicateObjects: false})).join('---\n');
}

export function writeCaseExpected(dir: string, rows: object[]) {
    fs.outputFileSync(path.join(dir, EXPECTED_FILE), formatRows(rows));
}

export function writeCaseActivities(dir: string, activities: Activity[]) {
    fs.outputFileSync(path.join(dir, ACTIVITY_FILE), formatRows(activities.map(toPlainActivity)));
}

// An activity as activity.yaml holds it: amounts as decimal strings with their decimals, times as ISO
// (fields that are undefined, e.g. a missing memo, are left out, as YAML can't hold them)
export function toPlainActivity(activity: Activity): object {
    return JSON.parse(JSON.stringify({
        ...activity,
        time: activity.time.toISOString(),
        legs: activity.legs.map(({amount, ...leg}) => ({...leg, amount: formatAmount(amount), decimals: amount.decimals})),
    }));
}

// A row as expected.yaml holds it: the timestamp as ISO, as the CSV writes it
// The row as expected.yaml holds it: its CSV columns (the trace is in the ID)
export function toPlainRow({trace, ...row}: CryptoTaxTransaction): object {
    return {...row, timestamp: row.timestamp.toISOString()};
}

// A case's input is a RawBundle, written without the fields that are at their default
export function toBundle(input: GoldenCaseInput): RawBundle {
    return {
        source: input.source,
        protocol: input.protocol ?? 'thorchain',
        wallet: input.wallet,
        data: input.data,
        thornodeTxs: input.thornodeTxs ?? [],
        cosmosTxs: input.cosmosTxs ?? [],
        ...(input.inbounds ? {inbounds: input.inbounds} : {}),
        ...(input.nativeFee ? {nativeFee: input.nativeFee} : {}),
    };
}

export function toCaseInput(bundle: RawBundle, description: string): GoldenCaseInput {
    return {
        description,
        source: bundle.source,
        ...(bundle.protocol === 'thorchain' ? {} : {protocol: bundle.protocol}),
        wallet: bundle.wallet,
        data: bundle.data,
        ...(bundle.thornodeTxs.length ? {thornodeTxs: bundle.thornodeTxs} : {}),
        ...(bundle.cosmosTxs.length ? {cosmosTxs: bundle.cosmosTxs} : {}),
        ...(bundle.inbounds?.length ? {inbounds: bundle.inbounds} : {}),
        ...(bundle.nativeFee ? {nativeFee: bundle.nativeFee} : {}),
    };
}

// Runs a case through the same path the exporter uses (runBundle). An unsupported action gives no rows;
// a failure throws, so a case can't pass by failing.
export function runCase(input: GoldenCaseInput): object[] {
    return runCaseLayers(input).rows;
}

// The activities a ported action type gives, and the rows as expected.yaml holds them
export function runCaseLayers(input: GoldenCaseInput): {activities: Activity[]; rows: object[]} {
    const {activities, rows, issues} = runBundle(toBundle(input), getProtocol(input.protocol), input.treatment);
    const failure = issues.find(issue => issue.kind === 'failed');

    if (failure) {
        throw new Error(failure.message);
    }

    return {activities, rows: rows.map(toPlainRow)};
}
