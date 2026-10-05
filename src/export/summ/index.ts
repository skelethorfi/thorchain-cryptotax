import {Activity, Leg} from "../../domain/Activity";
import {formatAmount} from "../../domain/Amount";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../../cryptotax";
import {parseMidgardAsset} from "../../cryptotax-thorchain/MidgardUtils";
import {AssetNamesConfig, getProtocol, Protocol, withAssetNames} from "../../protocols/Protocol";

// The tax choices the Summ rows depend on, from the config. Today: how assets are named
// (docs/specs/assets.md).
export interface Treatment {
    assets?: AssetNamesConfig;
}

// Activities as rows of Summ's advanced CSV, the same rows the old mappers wrote
export function exportSumm(activities: Activity[], treatment: Treatment = {}): CryptoTaxTransaction[] {
    return activities.flatMap(activity => toRows(activity, withAssetNames(getProtocol(activity.protocol), treatment.assets)));
}

function toRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    switch (activity.kind) {
        case 'bond':
        case 'unbond':
            return [bondRow(activity, protocol)];
    }
}

function bondRow(activity: Activity, protocol: Protocol): CryptoTaxTransaction {
    const principal = leg(activity, 'principal');
    const isBond = activity.kind === 'bond';
    const {currency, displayCurrency, amount} = named(principal, protocol);

    return {
        walletExchange: principal.wallet,
        timestamp: activity.time.toISOString(),
        type: isBond ? CryptoTaxTransactionType.StakingDeposit : CryptoTaxTransactionType.StakingWithdrawal,
        baseCurrency: currency,
        baseAmount: amount,
        ...fee(activity, protocol),
        from: isBond ? principal.wallet : protocol.counterparty,
        to: isBond ? protocol.counterparty : principal.wallet,
        blockchain: protocol.blockchain,
        id: `${activity.time.toISOString()}.${activity.kind}`,
        description: `1/1 - ${isBond ? 'Bond' : 'Unbond'} ${amount} ${displayCurrency} ${isBond ? 'to' : 'from'} ${activity.details.node}; ${activity.txids.in[0] ?? ''}`,
    };
}

function leg(activity: Activity, role: Leg['role']): Leg {
    const found = activity.legs.find(item => item.role === role);

    if (!found) {
        throw new Error(`${activity.kind} ${activity.id}: no ${role} leg`);
    }

    return found;
}

function named(item: Leg, protocol: Protocol) {
    const {currency, displayCurrency} = parseMidgardAsset(item.asset.notation, protocol);
    return {currency, displayCurrency, amount: formatAmount(item.amount)};
}

// The fee columns: the gas the wallet paid to send its transaction (docs/specs/fees.md)
function fee(activity: Activity, protocol: Protocol): Pick<CryptoTaxTransaction, 'feeCurrency' | 'feeAmount'> {
    const gas = activity.legs.find(item => item.role === 'gas');

    if (!gas) {
        return {};
    }

    const {currency, amount} = named(gas, protocol);
    return {feeCurrency: currency, feeAmount: amount};
}
