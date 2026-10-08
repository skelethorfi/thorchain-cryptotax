import type {Activity} from "../../domain/Activity.ts";
import {type CryptoTaxTransaction, CryptoTaxTransactionType} from "./csv/index.ts";
import type {Protocol} from "../../domain/Protocol.ts";
import {fee, leg, legTrace, named} from "./common.ts";

// One staking row: a bond deposits RUNE with the node, an unbond withdraws it
export function bondRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const principal = leg(activity, 'principal');
    const isBond = activity.kind === 'bond';
    const {currency, displayCurrency, amount} = named(principal, protocol);

    return [{
        walletExchange: principal.wallet,
        timestamp: activity.time,
        type: isBond ? CryptoTaxTransactionType.StakingDeposit : CryptoTaxTransactionType.StakingWithdrawal,
        baseCurrency: currency,
        baseAmount: amount,
        ...fee(activity, protocol),
        from: isBond ? principal.wallet : protocol.counterparty,
        to: isBond ? protocol.counterparty : principal.wallet,
        blockchain: protocol.blockchain,
        trace: legTrace(principal),
        description: `1/1 - ${isBond ? 'Bond' : 'Unbond'} ${amount} ${displayCurrency} ${isBond ? 'to' : 'from'} ${activity.details.node}; ${activity.txids.in[0] ?? ''}`,
    }];
}
