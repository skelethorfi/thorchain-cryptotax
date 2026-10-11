import type {Action} from "@xchainjs/xchain-midgard";
import {getBundleKey, type RawBundle} from "./RawBundle.ts";

// How old an action that is not final is, by its own date (docs/specs/pending.md):
// recent: younger than the grace period, it may still finalise; stuck: still pending past the cut-off;
// waiting: in between
export type PendingAge = 'recent' | 'waiting' | 'stuck';

export function pendingAge(date: Date, today: Date, graceDays: number, stuckDays: number): PendingAge {
    const days = ageInDays(date, today);
    return days < graceDays ? 'recent' : days >= stuckDays ? 'stuck' : 'waiting';
}

export function ageInDays(date: Date, today: Date): number {
    return (today.getTime() - date.getTime()) / 86400_000;
}

// A Midgard action whose status is not 'success', as a source listed it, and whether it was exported
export interface NotFinal {
    // The store record, e.g. 'midgard/refund.<txid>'
    key: string;
    action: Action;
    exported: boolean;
    // A successful action of the same inbound txid that accounts for it (e.g. a savers deposit's add)
    coveredBy?: string;
}

// For each action not exported nor covered, the Midgard send among the bundles that is its inbound (e.g. the RUNE
// sent to Maya's vault for a pending Maya swap), by key: that send is exported as a send and stands in for the
// action until it is final, when the action replaces it (docs/specs/pending.md)
export function inboundSends(notFinal: NotFinal[], bundles: RawBundle[]): Map<string, string> {
    const sends = new Map(bundles
        .filter(bundle => bundle.source === 'midgard' && (bundle.data as Action).type === 'send' && (bundle.data as Action).in[0]?.txID)
        .map(bundle => [(bundle.data as Action).in[0].txID.toUpperCase(), getBundleKey(bundle)]));

    return new Map(notFinal
        .filter(item => !item.exported && !item.coveredBy && item.action.type !== 'send' && item.action.in[0]?.txID)
        .map(item => [item.key, sends.get(item.action.in[0].txID.toUpperCase())])
        .filter((entry): entry is [string, string] => entry[1] !== undefined));
}
