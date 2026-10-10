import type {Activity} from "../../domain/Activity.ts";
import {formatAmount} from "../../domain/Amount.ts";
import {type SummRow, SummRowType} from "./csv/index.ts";
import {parseMidgardAsset} from "../../sources/thorchain/MidgardUtils.ts";
import type {Protocol} from "../../domain/Protocol.ts";
import {findLeg, leg, legTrace} from "./common.ts";

// The fee columns from the gas leg, or no fee columns at all when there is none (as these rows always had)
function feeIfAny(activity: Activity, protocol: Protocol): Pick<SummRow, 'feeCurrency' | 'feeAmount'> {
    const gas = findLeg(activity, 'gas');
    return gas ? {feeCurrency: parseMidgardAsset(gas.asset.notation, protocol).currency, feeAmount: formatAmount(gas.amount)} : {};
}

export function tcyClaimRows(activity: Activity, protocol: Protocol): SummRow[] {
    const tcy = leg(activity, 'principal', 'in');
    const amount = formatAmount(tcy.amount);
    const time = activity.time;

    return [{
        walletExchange: tcy.wallet,
        timestamp: time,
        type: SummRowType.Receive,
        baseCurrency: parseMidgardAsset(tcy.asset.notation, protocol).currency,
        baseAmount: amount,
        ...feeIfAny(activity, protocol),
        from: protocol.counterparty,
        to: tcy.wallet,
        blockchain: protocol.blockchain,
        trace: legTrace(tcy),
        description: `1/1 - Claim ${amount} TCY for address ${activity.details.claimedFor}; ${tcy.txid ?? ''}`,
    }];
}

export function tcyStakeRows(activity: Activity, protocol: Protocol): SummRow[] {
    const isStake = activity.kind === 'tcy.stake';
    const tcy = leg(activity, 'principal');
    const amount = formatAmount(tcy.amount);
    const time = activity.time;

    return [{
        walletExchange: tcy.wallet,
        timestamp: time,
        type: isStake ? SummRowType.StakingDeposit : SummRowType.StakingWithdrawal,
        baseCurrency: parseMidgardAsset(tcy.asset.notation, protocol).currency,
        baseAmount: amount,
        ...feeIfAny(activity, protocol),
        from: isStake ? tcy.wallet : protocol.counterparty,
        to: isStake ? protocol.counterparty : tcy.wallet,
        blockchain: protocol.blockchain,
        trace: legTrace(tcy),
        description: `1/1 - ${isStake ? 'Stake' : 'Unstake'} ${amount} TCY; ${tcy.txid ?? ''}`,
    }];
}

// A THORName is an expense: the RUNE paid when registering or renewing, and the fee
export function thornameRows(activity: Activity, protocol: Protocol): SummRow[] {
    const paid = findLeg(activity, 'principal', 'out');
    const gas = leg(activity, 'gas');
    const wallet = paid?.wallet ?? gas.wallet;
    const amount = paid ? formatAmount(paid.amount) : '';
    const time = activity.time;

    return [{
        walletExchange: wallet,
        timestamp: time,
        type: SummRowType.Expense,
        baseCurrency: paid ? parseMidgardAsset(paid.asset.notation, protocol).currency : '',
        baseAmount: amount,
        ...feeIfAny(activity, protocol),
        from: wallet,
        to: protocol.counterparty,
        blockchain: protocol.blockchain,
        trace: legTrace(paid ?? gas),
        description: paid ? `1/1 - Register/fund Thorname with ${amount} RUNE; ${gas.txid ?? ''}` : `1/1 - Update Thorname; ${gas.txid ?? ''}`,
    }];
}

// A TCY distribution is staking income, priced at the RUNE price the API gave for the day
export function tcyDistributionRows(activity: Activity, protocol: Protocol): SummRow[] {
    const reward = leg(activity, 'reward');
    const amount = formatAmount(reward.amount);
    const time = activity.time;

    return [{
        walletExchange: reward.wallet,
        timestamp: time,
        type: SummRowType.Staking,
        baseCurrency: parseMidgardAsset(reward.asset.notation, protocol).currency,
        baseAmount: amount,
        from: protocol.counterparty,
        to: reward.wallet,
        blockchain: protocol.blockchain,
        description: `1/1 - Received ${amount} RUNE from TCY staking`,
        trace: legTrace(reward),
        referencePricePerUnit: activity.prices.find(price => price.source === 'midgard:tcy.distribution.price')?.usd,
        referencePriceCurrency: 'USD',
    }];
}
