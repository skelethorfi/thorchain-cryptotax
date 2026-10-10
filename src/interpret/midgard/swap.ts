import type {Action, Transaction} from "@xchainjs/xchain-midgard";
import type {Activity, Leg, Price} from "../../domain/Activity.ts";
import {parseAmount} from "../../domain/Amount.ts";
import {toAsset} from "../../domain/Asset.ts";
import type {Issue} from "../../domain/Issue.ts";
import {getActionDate} from "../../sources/thorchain/MidgardUtils.ts";
import type {Protocol} from "../../domain/Protocol.ts";
import {getBundleKey, type RawBundle} from "../../sources/RawBundle.ts";
import {inboundGas} from "./gas.ts";

// https://dev.thorchain.org/concepts/memos.html#swap
const SWAP_DESTADDR = 2;

// A swap (docs/specs/activity.md): the wallet sends one asset in, and the protocol pays another out to
// the memo's destination. Affiliate outputs are the protocol's fees, already deducted, so they are not
// legs (docs/specs/fees.md). A streaming swap can return its unfilled part to the sender.
export function interpretSwap(bundle: RawBundle, protocol: Protocol): {activities: Activity[]; issues: Issue[]} {
    const action = bundle.data as Action;

    if (action.in.length !== 1) {
        throw new Error(`swap: expected 1 input but there were ${action.in.length}`);
    }

    const input = action.in[0];
    const inputCoin = input.coins[0];
    const inputAsset = toAsset(inputCoin.asset);
    const output = getOutput(action);
    const outputCoin = output.coins[0];
    const outputAsset = toAsset(outputCoin.asset);

    // A synth swapped from an L1 address is a savers withdrawal's internal leg, not the wallet's swap
    if (inputCoin.asset.includes('/') && !input.address.toLowerCase().startsWith(protocol.nativeAddressPrefix)) {
        return {activities: [], issues: [{kind: 'ignored', message: 'synth swap from an L1 address (a savers withdrawal)'}]};
    }

    // Can appear with lending transactions
    if (inputCoin.asset === 'THOR.TOR' || outputCoin.asset === 'THOR.TOR') {
        throw new Error('swap: invalid swap - THOR.TOR');
    }

    const amount = (coin: {asset: string; amount: string}) => parseAmount(coin.amount, protocol.decimals(coin.asset));
    const returnOutputs = getReturnOutputs(action, input, output);
    const returned = returnOutputs.flatMap(out => out.coins).filter(coin => coin.asset === inputCoin.asset)
        .reduce((sum, coin) => sum + BigInt(coin.amount), 0n);
    const txid = input.txID ?? '';
    const legs: Leg[] = [
        {direction: 'out', wallet: input.address, asset: inputAsset, amount: amount(inputCoin), role: 'principal', basis: 'observed', txid},
        ...(returned > 0n ? [{
            direction: 'in', wallet: input.address, asset: inputAsset, amount: amount({asset: inputCoin.asset, amount: returned.toString()}),
            role: 'returned', basis: 'observed', ...(returnOutputs[0].txID ? {txid: returnOutputs[0].txID} : {}),
        } as Leg] : []),
        {
            direction: 'in', wallet: output.address, asset: outputAsset, amount: amount(outputCoin), role: 'principal', basis: 'observed',
            ...(output.txID ? {txid: output.txID} : {}),
        },
    ];
    const gas = inboundGas(txid, bundle.thornodeTxs, input.address, inputCoin.asset, protocol);

    return {
        activities: [{
            id: getBundleKey(bundle),
            protocol: protocol.id,
            kind: 'swap',
            status: action.status as Activity['status'],
            time: getActionDate(action),
            memo: action.metadata.swap?.memo,
            legs: gas ? [...legs, {...gas, txid}] : legs,
            prices: getPrices(action, inputCoin.asset, outputCoin.asset),
            details: {},
        }],
        issues: [],
    };
}

function getPrices(action: Action, inputAsset: string, outputAsset: string): Price[] {
    const swap = action.metadata.swap;
    const prices: Price[] = [];

    if (swap?.inPriceUSD) {
        prices.push({asset: toAsset(inputAsset), usd: swap.inPriceUSD, source: 'midgard:swap.inPriceUSD'});
    }

    if (swap?.outPriceUSD) {
        prices.push({asset: toAsset(outputAsset), usd: swap.outPriceUSD, source: 'midgard:swap.outPriceUSD'});
    }

    return prices;
}

// The outputs, other than the swap output, that return the input asset to the sender
function getReturnOutputs(action: Action, input: Transaction, output: Transaction): Transaction[] {
    const inputAsset = input.coins[0].asset;

    return action.out.filter(out => out !== output && out.address.toLowerCase() === input.address.toLowerCase()
        && out.coins.some(coin => coin.asset === inputAsset));
}

// The output paid to the memo's destination; there may also be outputs for affiliates
function getOutput(action: Action): Transaction {
    const memo = action.metadata.swap?.memo;

    if (!memo) {
        throw new Error('swap: no memo');
    }

    const destAddress = memo.split(':')[SWAP_DESTADDR];

    if (!destAddress) {
        // A swap memo with an empty destination (e.g. =:ARB.ETH:::wr:0). Maya paid such a swap out to
        // the sender's address (same EVM address on another chain). Only accept an output in a different
        // asset from the input, so a refund of the input is never read as the swap.
        // (A send to a vault with no memo at all is refunded, and Midgard reports it as a refund action.)
        const sender = action.in[0].address.toLowerCase();
        const inputAsset = action.in[0].coins[0]?.asset;
        const out = action.out.find(out => out.address.toLowerCase() === sender && out.coins[0]?.asset !== inputAsset);

        if (!out) {
            throw new Error('swap: no matching out tx');
        }

        return out;
    }

    const out = action.out.find(out => out.address.toLowerCase() === destAddress.toLowerCase());

    if (!out) {
        throw new Error('swap: no matching out tx');
    }

    return out;
}
