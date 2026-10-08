import {Activity, Leg} from "../../domain/Activity";
import {formatAmount} from "../../domain/Amount";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "./csv";
import {parseMidgardAsset} from "../../sources/thorchain/MidgardUtils";
import {getLpTokenName} from "./ThorchainUtils";
import {formatBlockchain, Protocol} from "../../domain/Protocol";
import {legTrace, plusSeconds} from "./common";

// Summ needs a wallet for every row; an old deposit can have none
const MISSING_ADDRESS = 'MISSING-DEPOSIT-ADDRESS';

// Summ does not price the position token, so a spam row carries the value of what went in or came out, to
// copy onto the token row by hand (README, Liquidity): the first asset's amount times the number of assets.
function priceHelper(first: CryptoTaxTransaction, count: number): {currency: string; amount: string} {
    return {currency: first.baseCurrency, amount: (parseFloat(first.baseAmount) * count).toString()};
}

// The fee columns of a principal leg: the gas leg that follows it, blank when none (docs/specs/fees.md)
function feeFor(activity: Activity, item: Leg, protocol: Protocol): Pick<CryptoTaxTransaction, 'feeCurrency' | 'feeAmount'> {
    const next = activity.legs[activity.legs.indexOf(item) + 1];

    if (next?.role !== 'gas') {
        return {feeCurrency: '', feeAmount: ''};
    }

    return {feeCurrency: parseMidgardAsset(next.asset.notation, protocol).currency, feeAmount: formatAmount(next.amount)};
}

function describe(activity: Activity, assetCount: number): string {
    return activity.kind.startsWith('savers') ? 'savers' : (assetCount === 2 ? 'symmetric' : 'asymmetric');
}

// Each deposit as an add-liquidity row with its own fee, the position as a receive-LP-token row 10 s later,
// and the price-helper row 20 s later
export function addLiquidityRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const deposits = activity.legs.filter(item => item.role === 'principal' && item.direction === 'out');
    const position = activity.legs.find(item => item.role === 'principal' && item.direction === 'in')!;
    const lpToken = getLpTokenName(position.asset.notation, protocol);
    const symmetry = describe(activity, deposits.length);
    const total = deposits.length + 2;
    const txId = deposits[0].txid ?? '';
    const receiver = position.wallet || MISSING_ADDRESS;

    const rows: CryptoTaxTransaction[] = deposits.map((deposit, i) => {
        const {blockchain, currency} = parseMidgardAsset(deposit.asset.notation, protocol);
        const from = deposit.wallet || MISSING_ADDRESS;

        return {
            walletExchange: from,
            timestamp: activity.time,
            type: CryptoTaxTransactionType.AddLiquidity,
            baseCurrency: currency,
            baseAmount: formatAmount(deposit.amount),
            ...feeFor(activity, deposit, protocol),
            from,
            to: protocol.counterparty,
            blockchain: formatBlockchain(blockchain),
            trace: legTrace(deposit),
            description: `${i + 1}/${total} - Add liquidity ${currency} to ${lpToken} (${symmetry}); ${txId}`,
        };
    });
    const quote = priceHelper(rows[0], deposits.length);

    rows.push({
        walletExchange: receiver,
        timestamp: plusSeconds(activity.time, 10),
        type: CryptoTaxTransactionType.ReceiveLpToken,
        baseCurrency: lpToken,
        baseAmount: formatAmount(position.amount),
        from: protocol.counterparty,
        to: receiver,
        blockchain: protocol.blockchain,
        trace: legTrace(position),
        description: `${total - 1}/${total} - Receive LP token from ${lpToken} (${symmetry}); ${txId}`,
    }, {
        walletExchange: receiver,
        timestamp: plusSeconds(activity.time, 20),
        type: CryptoTaxTransactionType.Spam,
        baseCurrency: quote.currency,
        baseAmount: quote.amount,
        from: protocol.counterparty,
        to: receiver,
        trace: {role: 'price-helper'},
        description: `${total}/${total} - Dummy transaction to get market price to then manually apply to the receive LP token transaction ${lpToken} (${symmetry}); ${txId}`,
    });

    return rows.reverse();
}

// The position as a return-LP-token row carrying the request's fee, the price-helper row 10 s later, and each
// asset paid out as a remove-liquidity row 20 s later (the native asset first)
export function withdrawRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const paidOut = activity.legs.filter(item => item.role === 'principal' && item.direction === 'in');
    const position = activity.legs.find(item => item.role === 'principal' && item.direction === 'out')!;
    const nativeFirst = paidOut[0].wallet.startsWith(protocol.nativeChain.toLowerCase());
    const ordered = nativeFirst ? paidOut : [...paidOut].reverse();
    const lpToken = getLpTokenName(position.asset.notation, protocol);
    const symmetry = describe(activity, paidOut.length);
    const total = paidOut.length + 2;
    const txId = position.txid ?? '';

    const removals: CryptoTaxTransaction[] = ordered.map((out, i) => {
        const {blockchain, currency} = parseMidgardAsset(out.asset.notation, protocol);

        return {
            walletExchange: out.wallet,
            timestamp: plusSeconds(activity.time, 20),
            type: CryptoTaxTransactionType.RemoveLiquidity,
            baseCurrency: currency,
            baseAmount: formatAmount(out.amount),
            // What came out is already net of the protocol's fees (fees.md)
            feeCurrency: '',
            feeAmount: '',
            from: protocol.counterparty,
            to: out.wallet,
            blockchain: formatBlockchain(blockchain),
            trace: legTrace(out),
            description: `${total - i}/${total} - Remove liquidity ${currency} from ${lpToken} (${symmetry}); ${txId}`,
        };
    });
    const quote = priceHelper(removals[0], paidOut.length);

    // Listed request first, then reversed: the rows come out removals first, as they always have
    return [
        {
            walletExchange: position.wallet,
            timestamp: activity.time,
            type: CryptoTaxTransactionType.ReturnLpToken,
            baseCurrency: lpToken,
            baseAmount: formatAmount(position.amount),
            ...feeFor(activity, position, protocol),
            from: position.wallet,
            to: protocol.counterparty,
            blockchain: protocol.blockchain,
            trace: legTrace(position),
            description: `1/${total} - Return LP token to ${lpToken} (${symmetry}); ${txId}`,
        },
        {
            walletExchange: position.wallet,
            timestamp: plusSeconds(activity.time, 10),
            type: CryptoTaxTransactionType.Spam,
            baseCurrency: quote.currency,
            baseAmount: quote.amount,
            from: position.wallet,
            to: protocol.counterparty,
            trace: {role: 'price-helper'},
            description: `2/${total} - Dummy transaction to get market price to then manually apply to the return LP token transaction ${lpToken} (${symmetry}); ${txId}`,
        },
        ...removals,
    ].reverse();
}
