import {Activity} from "../../domain/Activity";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "./csv";
import {Protocol} from "../../domain/Protocol";
import {fee, findLeg, leg, legBlockchain, legTrace, named, plusSeconds, referencePrice} from "./common";

// A cross-chain trade: the trade-out on the sending wallet carries the fee; the trade-in on the receiving
// wallet comes 10 s later. A part returned unfilled is netted off the trade-out.
export function swapRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const sent = leg(activity, 'principal', 'out');
    const received = leg(activity, 'principal', 'in');
    const returned = findLeg(activity, 'returned');
    const swapped = {...sent.amount, base: sent.amount.base - (returned?.amount.base ?? 0n)};

    const input = named(sent, protocol, swapped);
    const output = named(received, protocol);
    const synth = (notation: string) => notation.includes('/') ? 'Synth ' : '';
    const swap = `Swap ${input.amount} ${synth(sent.asset.notation)}${input.displayCurrency} to ${output.amount} ${synth(received.asset.notation)}${output.displayCurrency}`;
    const returnedNote = returned ? ` (${named(returned, protocol).amount} ${input.displayCurrency} returned unfilled)` : '';
    const txId = activity.txids.in[0] ?? '';

    return [
        {
            walletExchange: sent.wallet,
            timestamp: activity.time,
            type: CryptoTaxTransactionType.BridgeTradeOut,
            baseCurrency: input.currency,
            baseAmount: input.amount,
            quoteCurrency: output.currency,
            quoteAmount: output.amount,
            ...fee(activity, protocol),
            from: sent.wallet,
            to: protocol.counterparty,
            blockchain: legBlockchain(sent, protocol),
            ...referencePrice(activity, 'midgard:swap.inPriceUSD'),
            trace: legTrace(sent),
            description: `1/2 - ${swap}${returnedNote}; ${txId}`,
        },
        {
            walletExchange: received.wallet,
            timestamp: plusSeconds(activity.time, 10),
            type: CryptoTaxTransactionType.BridgeTradeIn,
            baseCurrency: output.currency,
            baseAmount: output.amount,
            from: protocol.counterparty,
            to: received.wallet,
            blockchain: legBlockchain(received, protocol),
            ...referencePrice(activity, 'midgard:swap.outPriceUSD'),
            trace: legTrace(received),
            description: `2/2 - ${swap}; ${txId}`,
        },
    ];
}
