import {ViewblockTx} from "../viewblock";
import {Action} from "@xchainjs/xchain-midgard";
import {CryptoTaxTransaction} from "../cryptotax";
import {TcyDistributionItem} from "../cryptotax-thorchain/TcyDistributionService";
import {Protocol} from "../protocols/Protocol";
import {BundleSource, getBundleDate, RawBundle} from "../sources/RawBundle";
import {Issue} from "../domain/Issue";
import {interpret} from "../interpret/registry";
import {Activity} from "../domain/Activity";
import {exportSumm, Treatment} from "../export/summ";

// One bundle, interpreted
export class TaxEvent {
    activities: Activity[] = [];
    output: CryptoTaxTransaction[] = [];
    issues: Issue[] = [];

    constructor(public datetime: Date, public source: BundleSource, public input: ViewblockTx | Action | TcyDistributionItem) {
    }

    static fromBundle(bundle: RawBundle, protocol: Protocol, treatment: Treatment = {}): TaxEvent {
        const event = new TaxEvent(getBundleDate(bundle), bundle.source, bundle.data);
        const {activities, rows, issues} = interpret(bundle, protocol);
        event.activities = activities;
        event.output = [...rows, ...exportSumm(activities, treatment)];
        event.issues = issues;

        return event;
    }
}
