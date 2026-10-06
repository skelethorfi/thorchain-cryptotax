import {CryptoTaxTransaction} from "../export/summ/csv";
import {Activity} from "../domain/Activity";
import {Issue} from "../domain/Issue";
import {exportSumm, Treatment} from "../export/summ";
import {interpret} from "../interpret/registry";
import {Protocol} from "../domain/Protocol";
import {getBundleDate, RawBundle} from "../sources/RawBundle";

// One bundle, interpreted and exported. Pure: the shell logs the issues and writes the files.
export interface BundleResult {
    bundle: RawBundle;
    time: Date;
    activities: Activity[];
    // The rows of an action type not yet ported to activities, then the activities' rows
    rows: CryptoTaxTransaction[];
    issues: Issue[];
}

export function runBundle(bundle: RawBundle, protocol: Protocol, treatment: Treatment = {}): BundleResult {
    const {activities, rows, issues} = interpret(bundle, protocol);
    return {bundle, time: getBundleDate(bundle), activities, rows: [...rows, ...exportSumm(activities, treatment)], issues};
}

// Every row, newest bundle first. A failed bundle gives no rows. The sort is stable, so bundles at the
// same time keep the order they were listed in (wallet by wallet, then source by source).
export function collectRows(results: BundleResult[]): CryptoTaxTransaction[] {
    return results
        .filter(result => !result.issues.some(issue => issue.kind === 'failed'))
        .sort((a, b) => b.time.getTime() - a.time.getTime())
        .flatMap(result => result.rows);
}
