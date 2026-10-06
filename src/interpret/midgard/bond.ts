import {Action, BondMetadata} from "@xchainjs/xchain-midgard";
import {Activity, Leg} from "../../domain/Activity";
import {parseAmount} from "../../domain/Amount";
import {toAsset} from "../../domain/Asset";
import {getActionDate} from "../../sources/thorchain/MidgardUtils";
import {Protocol} from "../../domain/Protocol";
import {getBundleKey, RawBundle} from "../../sources/RawBundle";

// Bond and unbond (docs/specs/activity.md). The wallet sends a MsgDeposit with the BOND or UNBOND memo;
// a bond's RUNE goes from the wallet to the bond module, an unbond's comes back. No source gives the gas
// of a MsgDeposit, so it is the protocol's native fee, as a default.
export function interpretBond(bundle: RawBundle, protocol: Protocol): Activity {
    const action = bundle.data as Action;
    const isBond = action.type as string === 'bond';
    const request = action.in[0];
    const coin = isBond ? request.coins[0] : action.out[0].coins[0];

    const principal: Leg = {
        direction: isBond ? 'out' : 'in',
        wallet: request.address,
        asset: toAsset(coin.asset),
        amount: parseAmount(coin.amount, protocol.decimals(coin.asset)),
        role: 'principal',
        basis: 'observed',
    };

    return {
        id: getBundleKey(bundle),
        protocol: protocol.id,
        kind: isBond ? 'bond' : 'unbond',
        status: action.status as Activity['status'],
        time: getActionDate(action),
        txids: getTxids(action),
        memo: (action.metadata.bond as BondMetadata).memo,
        legs: [principal, nativeGas(request.address, protocol)],
        prices: [],
        details: {node: (action.metadata.bond as BondMetadata).nodeAddress},
    };
}

export function nativeGas(wallet: string, protocol: Protocol): Leg {
    return {
        direction: 'out',
        wallet,
        asset: toAsset(protocol.nativeAsset),
        amount: parseAmount(protocol.defaultGas ?? '0', protocol.decimals(protocol.nativeAsset)),
        role: 'gas',
        basis: 'default',
    };
}

export function getTxids(action: Action): Activity['txids'] {
    const ids = (txs: {txID?: string}[]) => [...new Set(txs.map(tx => tx.txID).filter((id): id is string => !!id))];
    return {in: ids(action.in), out: ids(action.out)};
}
