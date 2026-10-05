import {Activity} from "../../domain/Activity";
import {CryptoTaxTransaction} from "../../cryptotax";
import {bondRows} from "./bond";
import {swapRows} from "./swap";
import {refundRows} from "./refund";
import {addLiquidityRows, withdrawRows} from "./liquidity";
import {runePoolRows, switchRows} from "./switch";
import {loanOpenRows, loanRepayRows} from "./loan";
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
            return bondRows(activity, protocol);
        case 'swap':
            return swapRows(activity, protocol);
        case 'refund':
            return refundRows(activity, protocol);
        case 'lp.add':
        case 'savers.add':
            return addLiquidityRows(activity, protocol);
        case 'lp.withdraw':
        case 'savers.withdraw':
            return withdrawRows(activity, protocol);
        case 'switch':
            return switchRows(activity, protocol);
        case 'runepool.deposit':
        case 'runepool.withdraw':
            return runePoolRows(activity, protocol);
        case 'loan.open':
            return loanOpenRows(activity, protocol);
        case 'loan.repay':
            return loanRepayRows(activity, protocol);
    }
}
