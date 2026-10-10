import type {Activity} from "../../domain/Activity.ts";
import {formatAmount, parseAmount} from "../../domain/Amount.ts";
import {toAsset} from "../../domain/Asset.ts";
import type {Protocol} from "../../domain/Protocol.ts";
import {getBundleKey, type RawBundle} from "../../sources/RawBundle.ts";
import {getPayoutDate, type MayaFundPayout} from "../../sources/maya/MayaFundService.ts";

// A Maya fund payout: CACAO paid to a MAYA holder at a payout height (docs/specs/maya.md, Maya fund). One of 0
// (no MAYA held) is not an activity.
export function interpretMayaFund(bundle: RawBundle, protocol: Protocol): Activity[] {
    const payout = bundle.data as MayaFundPayout;
    const cacao = toAsset(protocol.nativeAsset);

    if (BigInt(payout.cacao) <= 0n) {
        return [];
    }

    return [{
        id: getBundleKey(bundle),
        protocol: protocol.id,
        kind: 'maya.fund',
        status: 'success',
        time: getPayoutDate(payout),
        txids: {in: [], out: []},
        legs: [{direction: 'in', wallet: bundle.wallet, asset: cacao, amount: parseAmount(payout.cacao, protocol.decimals(protocol.nativeAsset)), role: 'reward', basis: 'observed'}],
        prices: [],
        details: {
            height: String(payout.height),
            ...(payout.maya !== undefined ? {maya: formatAmount(parseAmount(payout.maya, protocol.decimals('MAYA')))} : {}),
        },
    }];
}
