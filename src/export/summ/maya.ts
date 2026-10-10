import type {Activity} from "../../domain/Activity.ts";
import {formatAmount} from "../../domain/Amount.ts";
import type {Protocol} from "../../domain/Protocol.ts";
import {type CryptoTaxTransaction, CryptoTaxTransactionType} from "./csv/index.ts";
import {leg, legTrace, named} from "./common.ts";

// A Maya fund payout is income when paid; MAYA is held, not staked (docs/specs/maya.md, Maya fund)
export function mayaDistributionRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const reward = leg(activity, 'reward');
    const {currency} = named(reward, protocol);
    const amount = formatAmount(reward.amount);

    return [{
        walletExchange: reward.wallet,
        timestamp: activity.time,
        type: CryptoTaxTransactionType.Income,
        baseCurrency: currency,
        baseAmount: amount,
        from: protocol.counterparty,
        to: reward.wallet,
        blockchain: protocol.blockchain,
        trace: legTrace(reward),
        description: `1/1 - Received ${amount} CACAO reward for holding MAYA; height ${activity.details.height}`,
    }];
}
