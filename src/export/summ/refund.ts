import type {Activity} from "../../domain/Activity.ts";
import {formatAmount} from "../../domain/Amount.ts";
import {type SummRow, SummRowType} from "./csv/index.ts";
import {formatBlockchain, type Protocol} from "../../domain/Protocol.ts";
import {fee, findLeg, leg, legTrace, named} from "./common.ts";

// A refund (docs/specs/fees.md): the send is a failed-out carrying the inbound fee, as Summ counts only a
// failed transaction's fee. What the protocol kept (sent − returned) is a separate fee row, or lost for a
// stuck refund still pending, which was never paid out (docs/specs/pending.md). The return itself is not a row.
// A stuck swap that paid nothing out gives the same rows, named a swap.
export function refundRows(activity: Activity, protocol: Protocol): SummRow[] {
    const sent = leg(activity, 'principal', 'out');
    const returned = findLeg(activity, 'returned');
    const returnedAmount = {...sent.amount, base: returned?.amount.base ?? 0n};
    const notReturned = {...sent.amount, base: sent.amount.base - returnedAmount.base};
    const {blockchain, currency, amount: sentAmount} = named(sent, protocol);
    const txId = sent.txid ?? '';
    const time = activity.time;
    const label = activity.kind === 'swap' ? 'swap' : 'refund';
    const rows: SummRow[] = [{
        wallet: sent.wallet,
        timestamp: time,
        type: SummRowType.FailedOut,
        baseCurrency: currency,
        baseAmount: sentAmount,
        ...fee(activity, protocol),
        from: sent.wallet,
        to: protocol.counterparty,
        blockchain: formatBlockchain(blockchain),
        trace: legTrace(sent),
        description: `${label} (${txId}): ${activity.details.reason}`,
    }];

    if (notReturned.base > 0n) {
        const returnTxId = returned?.txid;
        const returnedNote = `${formatAmount(returnedAmount)} ${currency} returned` + (returnTxId ? ` in ${returnTxId}` : '');
        const stuck = activity.status === 'pending';

        rows.push({
            wallet: sent.wallet,
            timestamp: time,
            type: stuck ? SummRowType.Lost : SummRowType.Fee,
            baseCurrency: currency,
            baseAmount: formatAmount(notReturned),
            from: sent.wallet,
            to: protocol.counterparty,
            blockchain: formatBlockchain(blockchain),
            trace: {role: 'unreturned', asset: sent.asset.notation},
            description: stuck
                ? `${label} (${txId}): never paid out (still pending), ${sentAmount} ${currency} sent, ${returnedNote}`
                : `refund (${txId}): kept by ${protocol.counterparty}, ${sentAmount} ${currency} sent, ${returnedNote}`,
        });
    }

    return rows;
}
