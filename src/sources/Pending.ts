import type {Action} from "@xchainjs/xchain-midgard";

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
