import {Action} from "@xchainjs/xchain-midgard";
import {Activity, Leg} from "../../domain/Activity";
import {formatAmount, parseAmount} from "../../domain/Amount";
import {toAsset} from "../../domain/Asset";
import {getActionDate} from "../../cryptotax-thorchain/MidgardUtils";
import {getDistributionDate, TcyDistributionItem} from "../../cryptotax-thorchain/TcyDistributionService";
import {Protocol} from "../../protocols/Protocol";
import {getBundleKey, RawBundle} from "../../sources/RawBundle";
import {getTxids, nativeGas} from "./bond";

// TCY amounts are reported with 8 decimals
const DECIMALS = 8;

const leg = (direction: Leg['direction'], wallet: string, coin: {asset: string; amount: string}, txid: string, role: Leg['role'] = 'principal'): Leg =>
    ({direction, wallet, asset: toAsset(coin.asset), amount: parseAmount(coin.amount, DECIMALS), role, basis: 'observed', txid});

// A TCY claim: TCY paid to a THORChain wallet for an address that held a claim. The native fee applies only
// when the claim was sent from that same wallet; otherwise it was paid on another chain.
export function interpretTcyClaim(bundle: RawBundle, protocol: Protocol): Activity {
    const action = bundle.data as Action;
    const input = action.in[0];
    const output = action.out[0];
    const txid = output.txID ?? '';

    return activity(bundle, protocol, 'tcy.claim', [
        leg('in', output.address, output.coins[0], txid),
        ...(input.address === output.address ? [{...nativeGas(output.address, protocol), txid}] : []),
    ], {claimedFor: input.address});
}

// Staking TCY sends it from the wallet; unstaking returns it. Both pay the native fee.
export function interpretTcyStake(bundle: RawBundle, protocol: Protocol): Activity {
    const action = bundle.data as Action;
    const isStake = action.type as string === 'tcy_stake';
    const tx = isStake ? action.in[0] : action.out[0];
    const txid = tx.txID ?? '';

    return activity(bundle, protocol, isStake ? 'tcy.stake' : 'tcy.unstake', [
        leg(isStake ? 'out' : 'in', tx.address, tx.coins[0], txid),
        {...nativeGas(tx.address, protocol), txid},
    ], {});
}

// A THORName registration or renewal pays RUNE to the protocol; an update pays nothing but the native fee.
// An update can have no input address: the wallet is the name's owner.
export function interpretThorname(bundle: RawBundle, protocol: Protocol): Activity {
    const action = bundle.data as Action;
    const input = action.in[0];
    const metadata = (action.metadata as any).thorname;
    const wallet = input.address || metadata?.owner || '';
    const txid = input.txID ?? '';

    return activity(bundle, protocol, 'thorname', [
        ...(input.coins.length ? [leg('out', wallet, input.coins[0], txid)] : []),
        {...nativeGas(wallet, protocol), txid},
    ], metadata?.thorname ? {name: metadata.thorname} : {});
}

// A TCY distribution: RUNE paid daily to TCY stakers, income for the wallet it was listed for. The API
// gives the RUNE price in USD at the time.
export function interpretTcyDistribution(bundle: RawBundle, protocol: Protocol): Activity {
    const item = bundle.data as TcyDistributionItem;
    const rune = toAsset(protocol.nativeAsset);

    return {
        id: getBundleKey(bundle),
        protocol: protocol.id,
        kind: 'tcy.distribution',
        status: 'success',
        time: getDistributionDate(item),
        txids: {in: [], out: []},
        legs: [{direction: 'in', wallet: bundle.wallet, asset: rune, amount: parseAmount(item.amount, DECIMALS), role: 'reward', basis: 'observed'}],
        prices: [{asset: rune, usd: formatAmount(parseAmount(item.price, DECIMALS)), source: 'midgard:tcy.distribution.price'}],
        details: {},
    };
}

function activity(bundle: RawBundle, protocol: Protocol, kind: Activity['kind'], legs: Leg[], details: Record<string, string>): Activity {
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
        details,
    };
}
