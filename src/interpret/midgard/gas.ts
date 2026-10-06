import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {assetFromStringEx, AssetType} from "@xchainjs/xchain-util";
import {Leg} from "../../domain/Activity";
import {parseAmount} from "../../domain/Amount";
import {toAsset} from "../../domain/Asset";
import {Protocol, THORCHAIN} from "../../domain/Protocol";

// The gas the wallet paid to send its inbound transaction (docs/specs/fees.md):
// 1. THORNode's gas for the tx (observed);
// 2. otherwise the native fee of a tx sent on THORChain (RUNE, a THORChain token, or a synth, trade or
//    secured asset), or of CACAO sent on Maya (default);
// 3. otherwise none: an L1 tx's gas is only known from THORNode.
export function inboundGas(txId: string, thornodeTxs: TxStatusResponse[], wallet: string, inputAsset: string | undefined,
                           protocol: Protocol): Leg | undefined {
    const gasCoin = thornodeTxs.find(tx => tx.tx?.id === txId)?.tx?.gas?.[0];
    const leg = (asset: string, amount: string, decimals: number, basis: Leg['basis']): Leg =>
        ({direction: 'out', wallet, asset: toAsset(asset), amount: parseAmount(amount, decimals), role: 'gas', basis});

    if (gasCoin?.asset) {
        // THORNode gives every gas amount in 1e8 units
        return leg(gasCoin.asset, gasCoin.amount, 8, 'observed');
    }

    if (!inputAsset) {
        return undefined;
    }

    let asset;

    try {
        asset = assetFromStringEx(inputAsset);
    } catch {
        throw new Error(`Failed to parse asset string: "${inputAsset}"`);
    }
    // A tx sent on THORChain pays THORChain's fee, also inside a Maya action (e.g. RUNE swapped on Maya)
    const sentOnThorchain = asset.chain === THORCHAIN.nativeChain
        || (protocol.id === THORCHAIN.id && [AssetType.SYNTH, AssetType.TRADE, AssetType.SECURED].includes(asset.type));

    if (sentOnThorchain) {
        return leg(THORCHAIN.nativeAsset, THORCHAIN.defaultGas!, THORCHAIN.decimals(THORCHAIN.nativeAsset), 'default');
    }

    if (inputAsset === protocol.nativeAsset && protocol.defaultGas) {
        return leg(protocol.nativeAsset, protocol.defaultGas, protocol.decimals(protocol.nativeAsset), 'default');
    }

    return undefined;
}
