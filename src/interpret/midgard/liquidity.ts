import {Action} from "@xchainjs/xchain-midgard";
import {Activity, Leg} from "../../domain/Activity";
import {formatAmount, parseAmount} from "../../domain/Amount";
import {toAsset, toPositionAsset} from "../../domain/Asset";
import {Issue} from "../../domain/Issue";
import {getActionDate} from "../../sources/thorchain/MidgardUtils";
import {Protocol} from "../../domain/Protocol";
import {getBundleKey, RawBundle} from "../../sources/RawBundle";
import {isDonateAdd, midgardActionKey} from "../../sources/store/Sources";
import {getTxids} from "./bond";
import {inboundGas} from "./gas";

// Liquidity units and savers units are reported with 8 decimals
const UNIT_DECIMALS = 8;

// An add to a liquidity pool or savers vault (docs/specs/activity.md, savers.md): each deposit is sent in,
// each followed by its own gas leg, and the position comes back to the first depositor's wallet.
export function interpretAddLiquidity(bundle: RawBundle, protocol: Protocol): {activities: Activity[]; issues: Issue[]} {
    const action = bundle.data as Action;
    const deposits = action.in;

    if (isDonateAdd(action) && bundle.inbounds?.length) {
        return interpretAuction(bundle, protocol);
    }

    if (deposits.length === 0 || deposits.length > 2) {
        throw new Error(`liquidity: expected 1 or 2 deposits but there were ${deposits.length}`);
    }

    // Two-sided: the native asset (e.g. RUNE) comes first
    if (deposits.length === 2 && deposits[0].coins[0].asset !== protocol.nativeAsset) {
        throw new Error(`liquidity: expected ${protocol.nativeAsset.split('.')[1]} as first asset in LP deposit`);
    }

    const position = toPositionAsset(action.pools[0]);
    const units = parseAmount(action.metadata.addLiquidity?.liquidityUnits ?? '', UNIT_DECIMALS);
    const legs: Leg[] = [];

    for (const deposit of deposits) {
        const coin = deposit.coins[0];
        const wallet = deposit.address ?? '';
        // Midgard reports a savers deposit's coin as the synth (BTC/BTC), but a wallet on the asset's own chain
        // sent the L1 asset and paid that chain's gas (savers.md)
        const sentOnL1 = position.position === 'savers' && !wallet.toLowerCase().startsWith(protocol.nativeAddressPrefix);
        const sentAsset = sentOnL1 ? coin.asset.replace('/', '.') : coin.asset;
        const txid = deposit.txID ?? '';
        const gas = inboundGas(txid, bundle.thornodeTxs, wallet, sentAsset, protocol);

        legs.push({
            direction: 'out', wallet, asset: toAsset(sentAsset), amount: parseAmount(coin.amount, protocol.decimals(coin.asset)),
            role: 'principal', basis: 'observed', txid,
        });

        if (gas) {
            legs.push({...gas, txid});
        }
    }

    legs.push({direction: 'in', wallet: deposits[0].address ?? '', asset: position, amount: units, role: 'principal', basis: 'observed'});

    return {
        activities: [activity(bundle, protocol, position.position === 'savers' ? 'savers.add' : 'lp.add', legs)],
        issues: [
            ...(deposits[0].address ? [] : [{kind: 'warning' as const, message: 'missing deposit address'}]),
            ...(isDonateAdd(action) ? [{kind: 'warning' as const, message: 'Maya liquidity auction add with no deposits found: exported as an ordinary add (maya.md)'}] : []),
        ],
    };
}

// Maya's liquidity auction (docs/specs/maya.md): each deposit, a THORChain send of RUNE, is an add of its own at
// its date; at the auction's end the position comes with the CACAO side and any RUNE above the deposits, both
// from the auction: received (reward legs), then added
function interpretAuction(bundle: RawBundle, protocol: Protocol): {activities: Activity[]; issues: Issue[]} {
    const action = bundle.data as Action;
    const cacaoSide = action.in.find(tx => tx.txID)!;
    const runeSide = action.in.find(tx => !tx.txID)!;
    const runeAsset = runeSide.coins[0].asset;
    const rune = (amount: string | bigint) => parseAmount(amount.toString(), protocol.decimals(runeAsset));
    const sends = bundle.inbounds!;
    const deposited = sends.reduce((sum, send) => sum + BigInt(send.in[0].coins[0].amount), 0n);
    const extra = BigInt(runeSide.coins[0].amount) - deposited;
    const deposits: Activity[] = sends.map(send => {
        const txid = send.in[0].txID ?? '';
        const wallet = send.in[0].address;
        const gas = inboundGas(txid, [], wallet, runeAsset, protocol);

        return {
            id: `midgard/${midgardActionKey(send)}`,
            protocol: protocol.id,
            kind: 'lp.auction.deposit',
            status: 'success',
            time: getActionDate(send),
            txids: {in: [txid], out: []},
            memo: (send.metadata as any)?.send?.memo || undefined,
            legs: [
                {direction: 'out', wallet, asset: toAsset(runeAsset), amount: rune(send.in[0].coins[0].amount), role: 'principal', basis: 'observed', txid},
                ...(gas ? [{...gas, txid}] : []),
            ],
            prices: [],
            details: {pool: action.pools[0]},
        };
    });
    const cacao = cacaoSide.coins[0];
    const supplied = (wallet: string, asset: string, amount: Leg['amount']): Leg[] => [
        {direction: 'in', wallet, asset: toAsset(asset), amount, role: 'reward', basis: 'observed'},
        {direction: 'out', wallet, asset: toAsset(asset), amount, role: 'principal', basis: 'observed'},
    ];
    const legs: Leg[] = [
        ...supplied(cacaoSide.address, cacao.asset, parseAmount(cacao.amount, protocol.decimals(cacao.asset))),
        ...(extra > 0n ? supplied(runeSide.address, runeAsset, rune(extra)) : []),
        {direction: 'in', wallet: cacaoSide.address, asset: toPositionAsset(action.pools[0]),
            amount: parseAmount(action.metadata.addLiquidity?.liquidityUnits ?? '', UNIT_DECIMALS), role: 'principal', basis: 'observed'},
    ];
    const position = {...activity(bundle, protocol, 'lp.auction.position', legs), details: {pool: action.pools[0], runeSide: formatAmount(rune(runeSide.coins[0].amount))}};
    const issues: Issue[] = extra < 0n
        ? [{kind: 'manual', message: `Maya liquidity auction: the position's RUNE side (${runeSide.coins[0].amount}) is less than the deposits (${deposited}); enter what happened to the difference by hand`}]
        : [];

    return {activities: [...deposits, position], issues};
}

// A withdrawal from a liquidity pool or savers vault: the wallet sends a request (with its gas) and gives
// up position units; the protocol pays out one or two assets. The request's own coin, usually dust, is not
// a leg: today's rows ignore it.
export function interpretWithdraw(bundle: RawBundle, protocol: Protocol): {activities: Activity[]; issues: Issue[]} {
    const action = bundle.data as Action;

    if (action.out.length === 0 || action.out.length > 2) {
        throw new Error(`liquidity: expected 1 or 2 withdrawn assets but there were ${action.out.length}`);
    }

    const position = toPositionAsset(action.pools[0]);
    const units = parseAmount(action.metadata.withdraw?.liquidityUnits ?? '', UNIT_DECIMALS);
    const request = action.in[0];
    const requestTxid = request.txID ?? '';
    // A request sent on THORChain without a coin pays the native fee
    const requestAsset = request.coins[0]?.asset
        ?? (request.address.startsWith(protocol.nativeChain.toLowerCase()) ? protocol.nativeAsset : undefined);
    const gas = inboundGas(requestTxid, bundle.thornodeTxs, request.address, requestAsset, protocol);

    const legs: Leg[] = [
        ...action.out.map((out): Leg => ({
            direction: 'in', wallet: out.address, asset: toAsset(out.coins[0].asset),
            amount: parseAmount(out.coins[0].amount, protocol.decimals(out.coins[0].asset)), role: 'principal', basis: 'observed',
            txid: out.txID ?? '',
        })),
        {
            direction: 'out', wallet: request.address, asset: position, amount: {...units, base: units.base < 0n ? -units.base : units.base},
            role: 'principal', basis: 'observed', txid: requestTxid,
        },
        ...(gas ? [{...gas, txid: requestTxid}] : []),
    ];

    return {activities: [activity(bundle, protocol, position.position === 'savers' ? 'savers.withdraw' : 'lp.withdraw', legs)], issues: []};
}

function activity(bundle: RawBundle, protocol: Protocol, kind: Activity['kind'], legs: Leg[]): Activity {
    const action = bundle.data as Action;
    const metadata = (action.metadata as any)[kind.endsWith('.add') || kind.startsWith('lp.auction') ? 'addLiquidity' : 'withdraw'];

    return {
        id: getBundleKey(bundle),
        protocol: protocol.id,
        kind,
        status: action.status as Activity['status'],
        time: getActionDate(action),
        txids: getTxids(action),
        memo: metadata?.memo || undefined,
        legs,
        prices: [],
        details: {pool: action.pools[0]},
    };
}
