import {Activity} from "../../domain/Activity";
import {formatAmount} from "../../domain/Amount";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../../cryptotax";
import {formatBlockchain, Protocol} from "../../protocols/Protocol";
import {fee, findLeg, leg, named} from "./common";

// A refund (docs/specs/fees.md): the send is a failed-out carrying the inbound fee, as Summ counts only a
// failed transaction's fee. What the protocol kept (sent − returned) is a separate fee row. The return
// itself is not a row.
export function refundRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const sent = leg(activity, 'principal', 'out');
    const returnedAmount = {...sent.amount, base: findLeg(activity, 'returned')?.amount.base ?? 0n};
    const kept = {...sent.amount, base: sent.amount.base - returnedAmount.base};
    const {blockchain, currency, amount: sentAmount} = named(sent, protocol);
    const txId = activity.txids.in[0] ?? '';
    const time = activity.time.toISOString();
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
        id: `${time}.refund`,
        description: `refund (${txId}): ${activity.details.reason}`,
    }];

    if (kept.base > 0n) {
        const returnTxId = activity.txids.out[0];
        const returnedNote = `${formatAmount(returnedAmount)} ${currency} returned` + (returnTxId ? ` in ${returnTxId}` : '');

        rows.push({
            walletExchange: sent.wallet,
            timestamp: time,
            type: CryptoTaxTransactionType.Fee,
            baseCurrency: currency,
            baseAmount: formatAmount(kept),
            from: sent.wallet,
            to: protocol.counterparty,
            blockchain: formatBlockchain(blockchain),
            id: `${time}.refund-fee`,
            description: `refund (${txId}): kept by ${protocol.counterparty}, ${sentAmount} ${currency} sent, ${returnedNote}`,
        });
    }

    return rows;
}
