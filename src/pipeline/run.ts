import type {SummRow} from "../export/summ/csv/index.ts";
import type {Activity} from "../domain/Activity.ts";
import type {Issue} from "../domain/Issue.ts";
import {exportSumm, type Treatment} from "../export/summ/index.ts";
import {interpret} from "../interpret/registry.ts";
import type {Protocol} from "../domain/Protocol.ts";
import {getBundleDate, type RawBundle} from "../sources/RawBundle.ts";

// One bundle, interpreted and exported. Pure: the shell logs the issues and writes the files.
export interface BundleResult {
    bundle: RawBundle;
    time: Date;
    activities: Activity[];
    // The rows of an action type not yet ported to activities, then the activities' rows
    rows: SummRow[];
    issues: Issue[];
}

export function runBundle(bundle: RawBundle, protocol: Protocol, treatment: Treatment = {}): BundleResult {
    const {activities, rows, issues} = interpret(bundle, protocol);
    return {bundle, time: getBundleDate(bundle), activities, rows: [...rows, ...exportSumm(activities, treatment)], issues};
}

// Every row, newest bundle first. A failed bundle gives no rows. The sort is stable, so bundles at the
// same time keep the order they were listed in (wallet by wallet, then source by source).
export function collectRows(results: BundleResult[]): SummRow[] {
    return results
        .filter(result => !result.issues.some(issue => issue.kind === 'failed'))
        .sort((a, b) => b.time.getTime() - a.time.getTime())
        .flatMap(result => result.rows);
}
