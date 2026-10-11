import type {Action} from "@xchainjs/xchain-midgard";
import type {Activity, Leg} from "../../domain/Activity.ts";
import {parseAmount} from "../../domain/Amount.ts";
import {toAsset} from "../../domain/Asset.ts";
import type {Issue} from "../../domain/Issue.ts";
import type {Protocol} from "../../domain/Protocol.ts";
import {getActionDate} from "../../sources/thorchain/MidgardUtils.ts";
import {getBundleKey, type RawBundle} from "../../sources/RawBundle.ts";
import {nativeGas} from "./bond.ts";

// A send (docs/specs/sends.md), as Midgard or Viewblock gives it
export interface Send {
    id: string;
    time: Date;
    txid: string;
    from: string;
    to: string;
    // Midgard notation; a bare name is the protocol's own chain's (TCY is THOR.TCY, MAYA is MAYA.MAYA)
    asset: string;
    // Base units
    amount: string;
    memo: string;
}

const ARKEO_DELEGATION = 'delegate:arkeo:';

export const ACTION_MEMO_WARNING = 'exported as a send, but its memo asks for an action no listed action matches';
export const SELF_SEND_MEMO_WARNING = 'sent to itself with a memo that asks for an action: no protocol received it, so it did nothing but pay the fee (a failed attempt?)';

// The run summary's line for the sends that warned of an action memo: RUNE sent to Maya's vault (e.g. a Maya
// swap) is one, unless the config lists Maya's actions
export function actionMemoSummary(count: number, protocols: string[]): string | undefined {
    if (count === 0) {
        return undefined;
    }

    const sends = count === 1
        ? '1 send carries a memo for an action (swap, add, …) that no listed action matches, so it is exported as a send'
        : `${count} sends carry a memo for an action (swap, add, …) that no listed action matches, so they are exported as sends`;

    return protocols.includes('maya')
        ? `WARN: ${sends}; Maya's actions are listed too, so check each (warnings above)`
        : `WARN: ${sends}. Maya swaps and adds look like this: add "maya" to protocols in the config to export them as swaps and adds`;
}

// A memo that asks THORChain or Maya to do something (swap, add, withdraw, trade, loan, name, bond, TCY), as
// opposed to a note such as an exchange's deposit id
const ACTION_MEMO = /^(=|swap|s|\+|add|a|-|wd|withdraw|loan[+-]|\$[+-]|trade[+-]|secure[+-]|pool[+-]|~|n|name|bond|unbond|tcy[+-]?)(:|$)/i;

// What a send to itself with an action memo was trying to do, for its description: e.g. 'TCY claim' for 'tcy:…'
const ACTION_NAMES: Record<string, string> = {'tcy': 'TCY claim', 'tcy+': 'TCY stake', 'tcy-': 'TCY unstake'};

export function failedActionName(memo: string): string | undefined {
    const prefix = ACTION_MEMO.exec(memo)?.[1].toLowerCase();
    return prefix === undefined ? undefined : ACTION_NAMES[prefix] ?? `'${prefix}' action`;
}

// A send from the side of the wallet whose listing gave it: the sender's legs (the coin and the native fee),
// or the receiver's (the coin). A send to itself is the sender's. A failed send moved no coin: its only leg is
// the sender's native fee, which was still paid (failedSend).
export function sendActivity(send: Send, wallet: string, protocol: Protocol, failed = false): Activity {
    const asset = /[./~-]/.test(send.asset) ? send.asset : `${protocol.nativeChain}.${send.asset}`;
    const isSender = send.from === wallet;
    // A send to itself with an action memo reached no protocol: a failed attempt at the action
    const failedAction = send.from === send.to ? failedActionName(send.memo) : undefined;

    if (!isSender && send.to !== wallet) {
        throw new Error(`a send from ${send.from} to ${send.to} listed for ${wallet}`);
    }

    if (failed && !isSender) {
        throw new Error('a failed send listed for its receiver');
    }

    const coin: Leg = {
        direction: isSender ? 'out' : 'in', wallet, asset: toAsset(asset), amount: parseAmount(send.amount, protocol.decimals(asset)),
        role: 'principal', basis: 'observed', txid: send.txid,
    };

    return {
        id: send.id,
        protocol: protocol.id,
        kind: 'send',
        status: failed ? 'failed' : 'success',
        time: send.time,
        memo: send.memo || undefined,
        legs: failed ? [{...nativeGas(wallet, protocol), txid: send.txid}]
            : isSender ? [coin, {...nativeGas(wallet, protocol), txid: send.txid}] : [coin],
        prices: [],
        details: {
            from: send.from, to: send.to,
            ...(send.memo.startsWith(ARKEO_DELEGATION) ? {purpose: 'delegate-arkeo'} : {}),
            ...(failedAction ? {failedAction} : {}),
        },
    };
}

// A failed send gives an activity only on its sender's side, where the fee was paid; its receiver got nothing
export function failedSend(send: Send, wallet: string, protocol: Protocol): {activities: Activity[]; issues: Issue[]} {
    return send.from === wallet
        ? {activities: [sendActivity(send, wallet, protocol, true)], issues: []}
        : {activities: [], issues: [{kind: 'ignored', message: 'failed send to the wallet: it moved nothing'}]};
}

// A Midgard send, on THORChain or Maya. A send with no coins (e.g. a TCY unstake request's memo) moves nothing.
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

    if (action.status === 'failed') {
        return failedSend(send, bundle.wallet, protocol);
    }

    // selectSends has dropped the sends another listed action explains; one with an action memo left over was
    // most likely received by a protocol whose actions this run does not list (actionMemoSummary). One sent to
    // itself reached no protocol: it did nothing but pay the fee, e.g. a failed attempt at the action.
    const issues: Issue[] = !ACTION_MEMO.test(send.memo) ? []
        : send.from === send.to ? [{kind: 'warning', message: `${SELF_SEND_MEMO_WARNING}: ${send.memo}`}]
        : [{kind: 'warning', message: `${ACTION_MEMO_WARNING}: ${send.memo}`}];

    return {activities: [sendActivity(send, bundle.wallet, protocol)], issues};
}
