import type {Activity} from "../../domain/Activity.ts";
import {formatAmount} from "../../domain/Amount.ts";
import type {Protocol} from "../../domain/Protocol.ts";
import {type SummRow, SummRowType} from "./csv/index.ts";
import {leg, legTrace, named} from "./common.ts";

// A CACAO payout to a MAYA holder is income when paid; MAYA is held, not staked (docs/specs/maya.md, CACAO to MAYA holders)
export function mayaDistributionRows(activity: Activity, protocol: Protocol): SummRow[] {
    const reward = leg(activity, 'reward');
    const {currency} = named(reward, protocol);
    const amount = formatAmount(reward.amount);

    return [{
        walletExchange: reward.wallet,
        timestamp: activity.time,
        type: SummRowType.Income,
        baseCurrency: currency,
        baseAmount: amount,
        from: protocol.counterparty,
        to: reward.wallet,
        blockchain: protocol.blockchain,
        trace: legTrace(reward),
        description: `1/1 - Received ${amount} CACAO reward for holding MAYA; height ${activity.details.height}`,
    }];
}
