import type {Activity, Leg} from "../../domain/Activity.ts";
import {type Amount, formatAmount} from "../../domain/Amount.ts";
import type {CryptoTaxTransaction, RowTrace} from "./csv/index.ts";
import {parseMidgardAsset} from "../../sources/thorchain/MidgardUtils.ts";
import {formatBlockchain, type Protocol} from "../../domain/Protocol.ts";

export function leg(activity: Activity, role: Leg['role'], direction?: Leg['direction']): Leg {
    const found = findLeg(activity, role, direction);

    if (!found) {
        throw new Error(`${activity.kind} ${activity.id}: no ${role} leg`);
    }

    return found;
}

export function findLeg(activity: Activity, role: Leg['role'], direction?: Leg['direction']): Leg | undefined {
    return activity.legs.find(item => item.role === role && (!direction || item.direction === direction));
}

// A leg's asset as the CSV names it (currency), as descriptions write it (displayCurrency), the
// blockchain it is on, and its amount
export function named(item: Leg, protocol: Protocol, amount: Amount = item.amount) {
    const {blockchain, currency, displayCurrency} = parseMidgardAsset(item.asset.notation, protocol);
    return {blockchain, currency, displayCurrency, amount: formatAmount(amount)};
}

// A synth is held on the protocol's chain when its wallet is an address there
export function legBlockchain(item: Leg, protocol: Protocol): string {
    const isSynth = item.asset.notation.includes('/');
    const onProtocol = isSynth && item.wallet.toLowerCase().startsWith(protocol.nativeAddressPrefix);
    const blockchain = onProtocol ? protocol.nativeChain : named(item, protocol).blockchain;
    return formatBlockchain(blockchain);
}

// The fee columns: the gas the wallet paid to send its transaction, blank when unknown (docs/specs/fees.md)
export function fee(activity: Activity, protocol: Protocol): Pick<CryptoTaxTransaction, 'feeCurrency' | 'feeAmount'> {
    const gas = findLeg(activity, 'gas');

    if (!gas) {
        return {feeCurrency: '', feeAmount: ''};
    }

    const {currency, amount} = named(gas, protocol);
    return {feeCurrency: currency, feeAmount: amount};
}

// The USD price the source observed, as the reference price columns
export function referencePrice(activity: Activity, source: string): Pick<CryptoTaxTransaction, 'referencePricePerUnit' | 'referencePriceCurrency'> {
    const usd = activity.prices.find(price => price.source === source)?.usd;
    return {referencePricePerUnit: usd || undefined, referencePriceCurrency: usd ? 'USD' : undefined};
}

export function plusSeconds(time: Date, seconds: number): Date {
    return new Date(time.getTime() + seconds * 1000);
}

// What a row records, for its ID (docs/specs/periods.md, Row IDs): the leg it is, named by what moved, not by how
// the row is exported, so a change of treatment (a trade exported as a bridge, a fee as lost) keeps the ID
export function legTrace(item: Leg): RowTrace {
    return {role: item.role === 'principal' ? item.direction : item.role, asset: item.asset.notation};
}
