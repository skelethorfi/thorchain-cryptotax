import {Action} from "@xchainjs/xchain-midgard";
import {Activity, Leg} from "../../domain/Activity";
import {parseAmount} from "../../domain/Amount";
import {toAsset} from "../../domain/Asset";
import {Issue} from "../../domain/Issue";
import {Protocol} from "../../domain/Protocol";
import {getActionDate} from "../../sources/thorchain/MidgardUtils";
import {getBundleKey, RawBundle} from "../../sources/RawBundle";
import {nativeGas} from "./bond";

// A send (docs/specs/sends.md), as Midgard or Viewblock gives it
export interface Send {
    id: string;
    time: Date;
    txid: string;
    from: string;
    to: string;
    // Midgard notation; a bare TCY is THOR.TCY
    asset: string;
    // Base units
    amount: string;
    memo: string;
}

const ARKEO_DELEGATION = 'delegate:arkeo:';

// A memo that asks THORChain or Maya to do something (swap, add, withdraw, trade, loan, name, bond, TCY), as
// opposed to a note such as an exchange's deposit id
const ACTION_MEMO = /^(=|swap|s|\+|add|a|-|wd|withdraw|loan[+-]|\$[+-]|trade[+-]|secure[+-]|pool[+-]|~|n|name|bond|unbond|tcy[+-]?)(:|$)/i;

// A send from the side of the wallet whose listing gave it: the sender's legs (the coin and the native fee),
// or the receiver's (the coin). A send to itself is the sender's.
export function sendActivity(send: Send, wallet: string, protocol: Protocol): Activity {
    const asset = send.asset === 'TCY' ? 'THOR.TCY' : send.asset;
    const isSender = send.from === wallet;

    if (!isSender && send.to !== wallet) {
        throw new Error(`a send from ${send.from} to ${send.to} listed for ${wallet}`);
    }

    const coin: Leg = {
        direction: isSender ? 'out' : 'in', wallet, asset: toAsset(asset), amount: parseAmount(send.amount, protocol.decimals(asset)),
        role: 'principal', basis: 'observed', txid: send.txid,
    };

    return {
        id: send.id,
        protocol: protocol.id,
        kind: 'send',
        status: 'success',
        time: send.time,
        txids: {in: [send.txid], out: []},
        memo: send.memo || undefined,
        legs: isSender ? [coin, {...nativeGas(wallet, protocol), txid: send.txid}] : [coin],
        prices: [],
        details: {from: send.from, to: send.to, ...(send.memo.startsWith(ARKEO_DELEGATION) ? {purpose: 'delegate-arkeo'} : {})},
    };
}

// A Midgard send on THORChain. A send with no coins (e.g. a TCY unstake request's memo) moves nothing.
export function interpretSend(bundle: RawBundle, protocol: Protocol): {activities: Activity[]; issues: Issue[]} {
    const action = bundle.data as Action;
    const input = action.in[0];
    const coin = input?.coins[0];

    if (!coin) {
        return {activities: [], issues: [{kind: 'ignored', message: 'Midgard send with no coins'}]};
    }

    const send: Send = {
        id: getBundleKey(bundle),
        time: getActionDate(action),
        txid: input.txID ?? '',
        from: input.address,
        to: action.out[0]?.address ?? '',
        asset: coin.asset,
        amount: coin.amount,
        memo: (action.metadata as any)?.send?.memo ?? '',
    };

    // selectSends has dropped the sends another listed action explains; one with an action memo left over was
    // most likely received by a protocol whose actions this run does not list
    const issues: Issue[] = ACTION_MEMO.test(send.memo)
        ? [{kind: 'warning', message: `exported as a send, but its memo asks for an action no listed action matches (on Maya? add "maya" to protocols): ${send.memo}`}]
        : [];

    return {activities: [sendActivity(send, bundle.wallet, protocol)], issues};
}
