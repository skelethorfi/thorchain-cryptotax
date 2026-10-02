import { TxStatusResponse } from '@xchainjs/xchain-thornode';
import { parseMidgardAsset } from './MidgardUtils';
import { baseToAssetAmountString } from '../utils/Amount';
import { assetFromStringEx, AssetType } from '@xchainjs/xchain-util';
import { formatBlockchain, Protocol, THORCHAIN } from '../protocols/Protocol';

export function getDefaultRuneGas(): string {
    return '2000000';
}

// THORChain's native transaction fee, paid on any transaction sent from a THORChain wallet
// (MsgDeposit/MsgSend). See docs/specs/fees.md.
export function getNativeRuneFee(): { feeCurrency: string; feeAmount: string } {
    return {
        feeCurrency: 'RUNE',
        feeAmount: baseToAssetAmountString(getDefaultRuneGas()),
    };
}

export function formatBlockchainForOutput(blockchain: string): string {
    return formatBlockchain(blockchain);
}

export function getInboundFee(
    txId: string,
    thornodeTxs: TxStatusResponse[],
    inputAsset?: string,
    protocol: Protocol = THORCHAIN
): { feeCurrency: string; feeAmount: string } {
    const thornodeTx = thornodeTxs.find((tx) => tx.tx?.id === txId);
    const gasCoin = thornodeTx?.tx?.gas?.[0];

    if (gasCoin?.asset) {
        const { currency } = parseMidgardAsset(gasCoin.asset);

        return {
            feeCurrency: currency,
            feeAmount: baseToAssetAmountString(gasCoin.amount),
        };
    }

    if (inputAsset) {
        const asset = assetFromStringEx(inputAsset);
        // Any transaction on THORChain (RUNE, TCY, KUJI, …) pays THORChain's native fee
        const shouldUseDefaultRuneGasFallback =
            asset.chain === 'THOR' ||
            (protocol === THORCHAIN && [AssetType.SYNTH, AssetType.TRADE, AssetType.SECURED].includes(asset.type));

        if (shouldUseDefaultRuneGasFallback) {
            return {
                feeCurrency: 'RUNE',
                feeAmount: baseToAssetAmountString(getDefaultRuneGas()),
            };
        }

        // e.g. CACAO sent to Maya pays Maya's native transaction fee
        if (inputAsset === protocol.nativeAsset && protocol.defaultGas) {
            return {
                feeCurrency: parseMidgardAsset(protocol.nativeAsset).currency,
                feeAmount: baseToAssetAmountString(protocol.defaultGas, protocol.decimals(protocol.nativeAsset)),
            };
        }
    }

    return {
        feeCurrency: '',
        feeAmount: '',
    };
}
