import { TxStatusResponse } from '@xchainjs/xchain-thornode';
import { parseMidgardAsset } from './MidgardUtils';
import { baseToAssetAmountString } from '../utils/Amount';
import { assetFromStringEx, AssetType } from '@xchainjs/xchain-util';

export function getDefaultRuneGas(): string {
    return '2000000';
}

export function formatBlockchainForOutput(blockchain: string): string {
    return blockchain === 'THOR' ? 'THORChain' : blockchain;
}

export function getInboundFee(
    txId: string,
    thornodeTxs: TxStatusResponse[],
    inputAsset?: string
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
        const shouldUseDefaultRuneGasFallback =
            inputAsset === 'THOR.RUNE' ||
            asset.type === AssetType.SYNTH ||
            asset.type === AssetType.TRADE ||
            asset.type === AssetType.SECURED;

        if (shouldUseDefaultRuneGasFallback) {
            return {
                feeCurrency: 'RUNE',
                feeAmount: baseToAssetAmountString(getDefaultRuneGas()),
            };
        }
    }

    return {
        feeCurrency: '',
        feeAmount: '',
    };
}
