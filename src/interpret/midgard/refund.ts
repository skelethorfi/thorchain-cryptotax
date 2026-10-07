import {Action} from "@xchainjs/xchain-midgard";
import {Activity, Leg} from "../../domain/Activity";
import {parseAmount} from "../../domain/Amount";
import {toAsset} from "../../domain/Asset";
import {Issue} from "../../domain/Issue";
import {getActionDate} from "../../sources/thorchain/MidgardUtils";
import {Protocol} from "../../domain/Protocol";
import {getBundleKey, RawBundle} from "../../sources/RawBundle";
import {getTxids} from "./bond";
import {inboundGas} from "./gas";

// A refund (docs/specs/fees.md): the wallet sent an amount in, and the protocol returned all or part of
// it, or, for a stuck one still pending, nothing yet (docs/specs/pending.md). Two refunds are not the wallet's own and give no activity: the refund of an affiliate's cut, which
// the wallet never sent, and the refund for the unfilled part of a partially filled swap, which the swap
// with the same txid already accounts for.
export function interpretRefund(bundle: RawBundle, protocol: Protocol): {activities: Activity[]; issues: Issue[]} {
    const action = bundle.data as Action;
    const input = action.in[0];
    const inputCoin = input.coins[0];
    const inputAsset = toAsset(inputCoin.asset);

    // THORChain swaps an affiliate's cut to RUNE as a swap of its own, carrying the user's txid and address.
    // THORNode shows what the wallet did send.
    const sentCoins = bundle.thornodeTxs.find(tx => tx.tx?.id === input.txID)?.tx?.coins;

    if (sentCoins && !sentCoins.some(coin => coin.asset.toUpperCase() === inputCoin.asset.toUpperCase())) {
        return {activities: [], issues: [{kind: 'ignored', message: "refund of an affiliate's cut, which the wallet did not send"}]};
    }

    const returnedCoins = action.out.flatMap(out => out.coins);

    if (returnedCoins.some(coin => coin.asset !== inputCoin.asset)) {
        return {activities: [], issues: [{kind: 'ignored', message: 'refund of a partially filled swap, which the swap accounts for'}]};
    }

    const decimals = protocol.decimals(inputCoin.asset);
    const returned = returnedCoins.reduce((sum, coin) => sum + BigInt(coin.amount), 0n);
    const legs: Leg[] = [
        {direction: 'out', wallet: input.address, asset: inputAsset, amount: parseAmount(inputCoin.amount, decimals), role: 'principal', basis: 'observed'},
        ...(returned > 0n ? [{
            direction: 'in', wallet: input.address, asset: inputAsset, amount: parseAmount(returned.toString(), decimals),
            role: 'returned', basis: 'observed',
        } as Leg] : []),
    ];
    const gas = inboundGas(input.txID ?? '', bundle.thornodeTxs, input.address, inputCoin.asset, protocol);
    const reason = ((action.metadata.refund as any)?.reason ?? '').replace(/[\n\t]/g, ' ').trim();
    // The source exports a pending refund only once it is stuck (docs/specs/pending.md)
    const issues: Issue[] = action.status === 'pending'
        ? [{kind: 'warning', message: 'refund still pending past the cut-off: what was not returned is exported as lost; check it never came back'}]
        : [];

    return {
        activities: [{
            id: getBundleKey(bundle),
            protocol: protocol.id,
            kind: 'refund',
            status: action.status as Activity['status'],
            time: getActionDate(action),
            txids: getTxids(action),
            memo: (action.metadata.refund as any)?.memo || undefined,
            legs: gas ? [...legs, gas] : legs,
            prices: [],
            details: {reason},
        }],
        issues,
    };
}
