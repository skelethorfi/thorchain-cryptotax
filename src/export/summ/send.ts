import {assetFromStringEx} from "@xchainjs/xchain-util";
import {Activity} from "../../domain/Activity";
import {Protocol} from "../../domain/Protocol";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "./csv";
import {fee, leg, legTrace, named} from "./common";

// A send or a receive on the wallet that listed it; an Arkeo delegation is a send to itself
// (docs/specs/sends.md)
export function sendRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const coin = leg(activity, 'principal');
    const isSend = coin.direction === 'out';
    const type = isSend ? CryptoTaxTransactionType.Send : CryptoTaxTransactionType.Receive;
    const {currency, amount} = named(coin, protocol);
    const ticker = assetFromStringEx(coin.asset.notation).ticker;
    const label = coin.asset.kind === 'synth' ? `Synth ${ticker}` : coin.asset.kind === 'trade' ? `Trade ${ticker}` : ticker;
    const txId = coin.txid ?? '';
    const description = activity.details.purpose === 'delegate-arkeo'
        ? `1/1 - DelegateArkeoWallet; ${txId}`
        : `${isSend ? 'Send' : 'Receive'} ${amount} ${label}; ${txId}`;

    return [{
        walletExchange: coin.wallet,
        timestamp: activity.time,
        type,
        baseCurrency: currency,
        baseAmount: amount,
        ...(isSend ? fee(activity, protocol) : {}),
        from: activity.details.from,
        to: activity.details.to,
        blockchain: protocol.blockchain,
        trace: legTrace(coin),
        description,
    }];
}
