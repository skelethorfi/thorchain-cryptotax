import {Activity} from "../../domain/Activity";
import {formatAmount} from "../../domain/Amount";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "./csv";
import {parseMidgardAsset} from "../../sources/thorchain/MidgardUtils";
import {formatBlockchain, Protocol} from "../../domain/Protocol";
import {fee, leg, plusSeconds} from "./common";

// A switch is a bridge: the asset leaves its old chain and arrives on THORChain 10 s later
export function switchRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const sent = leg(activity, 'principal', 'out');
    const received = leg(activity, 'principal', 'in');
    const input = parseMidgardAsset(sent.asset.notation, protocol);
    const output = parseMidgardAsset(received.asset.notation, protocol);
    const from = `${input.blockchain}.${input.currency}`;
    const to = `${output.blockchain}.${output.currency}`;
    const txId = sent.txid ?? '';
    const idPrefix = activity.time.toISOString();

    return [
        {
            walletExchange: sent.wallet,
            timestamp: activity.time,
            type: CryptoTaxTransactionType.BridgeOut,
            baseCurrency: input.currency,
            baseAmount: formatAmount(sent.amount),
            ...fee(activity, protocol),
            from: sent.wallet,
            to: received.wallet,
            blockchain: formatBlockchain(input.blockchain),
            id: `${idPrefix}.bridge-out`,
            description: `1/2 - Switch ${from} to ${to} (send ${from}); ${txId}`,
        },
        {
            walletExchange: received.wallet,
            timestamp: plusSeconds(activity.time, 10),
            type: CryptoTaxTransactionType.BridgeIn,
            baseCurrency: output.currency,
            baseAmount: formatAmount(received.amount),
            from: sent.wallet,
            to: received.wallet,
            blockchain: formatBlockchain(output.blockchain),
            id: `${idPrefix}.bridge-in`,
            description: `2/2 - Switch ${from} to ${to} (receive ${to}); ${txId}`,
        },
    ];
}

const RUNEPOOL = 'RUNEPool';

// RUNEPool is exported as a liquidity position in THORChain's RUNE pool token: a deposit adds liquidity and
// receives the token 10 s later; a withdrawal returns the token and removes liquidity 10 s later
export function runePoolRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const isDeposit = activity.kind === 'runepool.deposit';
    const rune = leg(activity, 'principal', isDeposit ? 'out' : 'in');
    const position = leg(activity, 'principal', isDeposit ? 'in' : 'out');
    const token = `${protocol.lpTokenPrefix}.${protocol.nativeAsset}`;
    const currency = parseMidgardAsset(rune.asset.notation, protocol).currency;
    const amount = formatAmount(rune.amount);
    const txId = rune.txid ?? '';
    const idPrefix = activity.time.toISOString();
    const wallet = rune.wallet;

    if (isDeposit) {
        return [
            {
                walletExchange: wallet, timestamp: activity.time, type: CryptoTaxTransactionType.AddLiquidity,
                baseCurrency: currency, baseAmount: amount, ...fee(activity, protocol), from: wallet, to: protocol.counterparty,
                blockchain: protocol.blockchain, id: `${idPrefix}.add-liquidity`, description: `1/2 - Deposit ${amount} ${currency} to ${RUNEPOOL}; ${txId}`,
            },
            {
                walletExchange: wallet, timestamp: plusSeconds(activity.time, 10), type: CryptoTaxTransactionType.ReceiveLpToken,
                baseCurrency: token, baseAmount: formatAmount(position.amount), from: protocol.counterparty, to: wallet,
                blockchain: protocol.blockchain, id: `${idPrefix}.receive-lp-token`, description: `2/2 - Receive LP token from ${RUNEPOOL}; ${txId}`,
            },
        ];
    }

    return [
        {
            walletExchange: wallet, timestamp: activity.time, type: CryptoTaxTransactionType.ReturnLpToken,
            baseCurrency: token, baseAmount: formatAmount(position.amount), ...fee(activity, protocol), from: wallet, to: protocol.counterparty,
            blockchain: protocol.blockchain, id: `${idPrefix}.return-lp-token`, description: `1/2 - Return LP token to ${RUNEPOOL}; ${txId}`,
        },
        {
            walletExchange: wallet, timestamp: plusSeconds(activity.time, 10), type: CryptoTaxTransactionType.RemoveLiquidity,
            baseCurrency: currency, baseAmount: amount, from: protocol.counterparty, to: wallet,
            blockchain: protocol.blockchain, id: `${idPrefix}.remove-liquidity`, description: `2/2 - Withdraw ${amount} ${currency} from ${RUNEPOOL}; ${txId}`,
        },
    ];
}
