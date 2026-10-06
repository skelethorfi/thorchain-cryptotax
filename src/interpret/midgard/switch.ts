import {Action} from "@xchainjs/xchain-midgard";
import {Activity, Leg} from "../../domain/Activity";
import {parseAmount} from "../../domain/Amount";
import {toAsset} from "../../domain/Asset";
import {getActionDate} from "../../sources/thorchain/MidgardUtils";
import {Protocol} from "../../domain/Protocol";
import {getBundleKey, RawBundle} from "../../sources/RawBundle";
import {getTxids, nativeGas} from "./bond";
import {inboundGas} from "./gas";

// A switch (docs/specs/activity.md): an asset from another chain (e.g. BEP2 RUNE, Cosmos KUJI) sent in and
// the same asset minted on THORChain
export function interpretSwitch(bundle: RawBundle, protocol: Protocol): Activity {
    const action = bundle.data as Action;
    const input = action.in[0];
    const output = action.out[0];
    const leg = (direction: Leg['direction'], wallet: string, coin: {asset: string; amount: string}, txid: string): Leg => ({
        direction, wallet, asset: toAsset(coin.asset), amount: parseAmount(coin.amount, protocol.decimals(coin.asset)),
        role: 'principal', basis: 'observed', txid,
    });
    const txid = input.txID ?? '';
    const gas = inboundGas(txid, bundle.thornodeTxs, input.address, input.coins[0].asset, protocol);

    return activity(bundle, protocol, 'switch', [
        leg('out', input.address, input.coins[0], txid),
        ...(gas ? [{...gas, txid}] : []),
        leg('in', output.address, output.coins[0], output.txID ?? ''),
    ]);
}

// RUNEPool: RUNE deposited for RUNEPool units, or units returned for RUNE. Both are sent from a THORChain
// wallet and pay the native fee.
export function interpretRunePool(bundle: RawBundle, protocol: Protocol): Activity {
    const action = bundle.data as Action;
    const isDeposit = action.type as string === 'runePoolDeposit';
    const tx = isDeposit ? action.in[0] : action.out[0];
    const coin = tx.coins[0];
    const units = (action.metadata as any)[isDeposit ? 'runePoolDeposit' : 'runePoolWithdraw']?.units ?? '';
    const txid = tx.txID ?? '';
    const rune: Leg = {
        direction: isDeposit ? 'out' : 'in', wallet: tx.address, asset: toAsset(coin.asset),
        amount: parseAmount(coin.amount, protocol.decimals(coin.asset)), role: 'principal', basis: 'observed', txid,
    };
    const position: Leg = {
        direction: isDeposit ? 'in' : 'out', wallet: tx.address, asset: {notation: protocol.nativeAsset, kind: 'position', position: 'runepool'},
        amount: parseAmount(units, 8), role: 'principal', basis: 'observed', txid,
    };
    const gas = {...nativeGas(tx.address, protocol), txid};

    return activity(bundle, protocol, isDeposit ? 'runepool.deposit' : 'runepool.withdraw',
        isDeposit ? [rune, gas, position] : [position, gas, rune]);
}

function activity(bundle: RawBundle, protocol: Protocol, kind: Activity['kind'], legs: Leg[]): Activity {
    const action = bundle.data as Action;

    return {
        id: getBundleKey(bundle),
        protocol: protocol.id,
        kind,
        status: action.status as Activity['status'],
        time: getActionDate(action),
        txids: getTxids(action),
        legs,
        prices: [],
        details: {},
    };
}
