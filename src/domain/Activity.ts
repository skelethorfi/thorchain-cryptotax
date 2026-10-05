import {ProtocolId} from "../protocols/Protocol";
import {Amount} from "./Amount";
import {Asset} from "./Asset";

// What happened on-chain, independent of any tax tool and of which wallet is exported
// (docs/specs/activity.md). Interpreters make it from a bundle; exporters turn it into rows.

// One kind per thing that happens. The union grows as each action type is ported to an activity, so every
// exporter has to handle a kind before it can be emitted.
export type ActivityKind = 'bond' | 'unbond' | 'swap' | 'refund' | 'lp.add' | 'lp.withdraw' | 'savers.add' | 'savers.withdraw'
    | 'switch' | 'runepool.deposit' | 'runepool.withdraw' | 'loan.open' | 'loan.repay';

export type ActivityStatus = 'success' | 'pending' | 'failed';

export interface Activity {
    // The bundle's store record key, e.g. midgard/bond.<txid>
    id: string;
    protocol: ProtocolId;
    kind: ActivityKind;
    status: ActivityStatus;
    time: Date;
    // The txids the wallet sent (in) and the protocol paid out (out), as the source gives them
    txids: {in: string[]; out: string[]};
    memo?: string;
    legs: Leg[];
    // USD prices the source observed at the time (e.g. a swap's inPriceUSD)
    prices: Price[];
    // What else a kind needs to be described, e.g. a bond's node address
    details: Record<string, string>;
}

// principal: the amount the action is about; gas: what the wallet paid to send its transaction;
// returned: sent back by the protocol (e.g. a refund); reward: income paid to the wallet
export type LegRole = 'principal' | 'gas' | 'returned' | 'reward';

// observed: the source states this amount; default: assumed, e.g. THORChain's 0.02 RUNE native fee when
// no source gives the gas
export type Basis = 'observed' | 'default';

export interface Leg {
    // Out of or into the wallet
    direction: 'out' | 'in';
    wallet: string;
    asset: Asset;
    amount: Amount;
    role: LegRole;
    basis: Basis;
    // The on-chain tx the amount moved in, when the source gives it
    txid?: string;
}

export interface Price {
    asset: Asset;
    usd: string;
    // Where it came from, e.g. 'midgard:swap.inPriceUSD'
    source: string;
}
