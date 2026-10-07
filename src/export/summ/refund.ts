import {Activity} from "../../domain/Activity";
import {formatAmount} from "../../domain/Amount";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "./csv";
import {formatBlockchain, Protocol} from "../../domain/Protocol";
import {fee, findLeg, leg, legTrace, named} from "./common";

// A refund (docs/specs/fees.md): the send is a failed-out carrying the inbound fee, as Summ counts only a
// failed transaction's fee. What the protocol kept (sent − returned) is a separate fee row, or lost for a
// stuck refund still pending, which was never paid out (docs/specs/pending.md). The return itself is not a row.
export function refundRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const sent = leg(activity, 'principal', 'out');
    const returnedAmount = {...sent.amount, base: findLeg(activity, 'returned')?.amount.base ?? 0n};
    const notReturned = {...sent.amount, base: sent.amount.base - returnedAmount.base};
    const {blockchain, currency, amount: sentAmount} = named(sent, protocol);
    const txId = activity.txids.in[0] ?? '';
    const time = activity.time;
    const rows: CryptoTaxTransaction[] = [{
        walletExchange: sent.wallet,
        timestamp: time,
        type: CryptoTaxTransactionType.FailedOut,
        baseCurrency: currency,
        baseAmount: sentAmount,
        ...fee(activity, protocol),
        from: sent.wallet,
        to: protocol.counterparty,
        blockchain: formatBlockchain(blockchain),
        trace: legTrace(sent),
        description: `refund (${txId}): ${activity.details.reason}`,
    }];

    if (notReturned.base > 0n) {
        const returnTxId = activity.txids.out[0];
        const returnedNote = `${formatAmount(returnedAmount)} ${currency} returned` + (returnTxId ? ` in ${returnTxId}` : '');
        const stuck = activity.status === 'pending';

        rows.push({
            walletExchange: sent.wallet,
            timestamp: time,
            type: stuck ? CryptoTaxTransactionType.Lost : CryptoTaxTransactionType.Fee,
            baseCurrency: currency,
            baseAmount: formatAmount(notReturned),
            from: sent.wallet,
            to: protocol.counterparty,
            blockchain: formatBlockchain(blockchain),
            trace: {role: 'not-returned', asset: sent.asset.notation},
            description: stuck
                ? `refund (${txId}): never paid out (still pending), ${sentAmount} ${currency} sent, ${returnedNote}`
                : `refund (${txId}): kept by ${protocol.counterparty}, ${sentAmount} ${currency} sent, ${returnedNote}`,
        });
    }

    return rows;
}
