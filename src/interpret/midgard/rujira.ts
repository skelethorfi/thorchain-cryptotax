import {Action} from "@xchainjs/xchain-midgard";
import {Activity, Leg} from "../../domain/Activity";
import {parseAmount} from "../../domain/Amount";
import {Asset, toAsset} from "../../domain/Asset";
import {Issue} from "../../domain/Issue";
import {CosmosTx} from "../../cryptotax-thorchain/CosmosTxService";
import {getActionDate} from "../../cryptotax-thorchain/MidgardUtils";
import {Protocol} from "../../protocols/Protocol";
import {getBundleKey, RawBundle} from "../../sources/RawBundle";
import {getTxids} from "./bond";

// Rujira contract actions (wasm calls on THORChain). See docs/specs/rujira.md.

// Merge pool contract → the asset it merges into RUJI (Rujira API `merge { address mergeAsset }`, 2026-10-03).
// A withdraw names only the contract.
const MERGE_POOLS: {[contract: string]: string} = {
    thor14hj2tavq8fpesdwxxcu44rty3hh90vhujrvcmstl4zr3txmfvw9s3p2nzy: 'THOR.KUJI',
    thor1yyca08xqdgvjz0psg56z67ejh9xms6l436u8y58m82npdqqhmmtqrsjrgh: 'THOR.RKUJI',
    thor1suhgf5svhu4usrurvxzlgn54ksxmn8gljarjtxqnapv8kjnp4nrsw5xx2d: 'THOR.FUZN',
    thor1cnuw3f076wgdyahssdkd0g3nr96ckq8cwa2mh029fn5mgf2fmcmsmam5ck: 'THOR.NSTK',
    thor1yw4xvtc43me9scqfr2jr2gzvcxd3a9y4eq7gaukreugw2yd2f8tsz3392y: 'THOR.WINK',
    thor1ltd0maxmte3xf4zshta9j5djrq9cl692ctsp9u5q0p9wss0f5lms7us4yf: 'THOR.LVN',
    thor1nr6vw0h9egm4chpgdufer7q0dareyu3a89l434z5gkzmwrjy7rtqwcjlag: 'THOR.NAMI',
};

// Midgard reports one contract action per wasm event, and each carries the wallet's message and funds.
// Only the event of the call the wallet made is mapped; these events happen inside it and give nothing.
const INNER_EVENTS = [
    'wasm-rujira-brune/mint',
    'wasm-rujira-brune/fee.allocate',
    'wasm-rujira-brune/fee.distribute',
    'wasm-rujira-staking/settle',
    'wasm-deferred-exec-queued',
];

// The message the wallet sends for each mapped event. FIN trades are checked by contract instead (finTrade).
const PRIMARY_MSGS: {[contractType: string]: (msg: any) => boolean} = {
    'wasm-rujira-staking/liquid.bond': msg => !!msg.liquid?.bond,
    'wasm-rujira-staking/account.bond': msg => !!msg.account?.bond,
    'wasm-rujira-merge/deposit': msg => !!msg.deposit,
    'wasm-rujira-merge/withdraw': msg => !!msg.withdraw,
    'wasm-crank-fee': msg => !!msg.open_position,
};

export const RUJIRA_CONTRACT_TYPES = [
    'wasm-rujira-staking/liquid.bond',
    'wasm-rujira-staking/account.bond',
    'wasm-rujira-fin/trade',
    'wasm-rujira-merge/deposit',
    'wasm-rujira-merge/withdraw',
    'wasm-crank-fee',
    ...INNER_EVENTS,
];

// Amounts on THORChain have 8 decimals, whatever the denom
const DECIMALS = 8;

interface Coin {
    denom: string;
    amount: string;
}

interface Contract {
    contractType: string;
    funds?: string;
    msg?: any;
    attributes: {[key: string]: string};
}

// "100x/ruji,5rune" → coins
export function parseCoins(coins: string): Coin[] {
    return coins.split(',').filter(Boolean).map(coin => {
        const match = coin.match(/^(\d+)(.+)$/);

        if (!match) {
            throw new Error(`Invalid coin: ${coin}`);
        }

        return {amount: match[1], denom: match[2]};
    });
}

// Cosmos denom → Midgard asset: rune → THOR.RUNE, x/ruji → X/RUJI, thor.kuji → THOR.KUJI, eth-usdc-0x… → ETH-USDC-0X…
// (Rujira runs on THORChain only)
function denomToAsset(denom: string): string {
    return denom === 'rune' ? 'THOR.RUNE' : denom.toUpperCase();
}

type Result = {activities: Activity[]; issues: Issue[]};

export function interpretRujira(bundle: RawBundle, protocol: Protocol): Result {
    const action = bundle.data as Action;
    const contract: Contract = (action.metadata as any).contract;
    const call = new Call(bundle, action, contract, protocol);

    if (INNER_EVENTS.includes(contract.contractType)) {
        return ignored(`${contract.contractType}: an event inside the wallet's call`);
    }

    // An event raised inside another call carries that call's message and funds, so it can't be mapped alone
    const expectedMsg = PRIMARY_MSGS[contract.contractType];

    if (expectedMsg && !expectedMsg(contract.msg ?? {})) {
        throw new Error(`rujira: ${contract.contractType} inside another call (${JSON.stringify(contract.msg)}) is not supported`);
    }

    switch (contract.contractType) {
        case 'wasm-rujira-staking/liquid.bond':
            return call.result('rujira.stake', [call.fundsLeg()], {bond: 'liquid', shares: contract.attributes.shares});
        case 'wasm-rujira-staking/account.bond':
            return call.result('rujira.stake', [call.fundsLeg()], {bond: 'account'});
        case 'wasm-rujira-fin/trade':
            return call.finTrade();
        case 'wasm-rujira-merge/deposit': {
            const funds = call.fundsLeg();
            const position = call.leg('in', mergeAsset(funds.asset.notation), contract.attributes.shares);
            return call.result('rujira.merge.deposit', [funds, position], {});
        }
        case 'wasm-rujira-merge/withdraw': {
            const pool = action.out[0]?.address ?? '';
            const merged = MERGE_POOLS[pool];

            if (!merged) {
                throw new Error(`rujira: unknown merge pool ${pool}`);
            }

            return call.result('rujira.merge.withdraw', [
                call.leg('out', mergeAsset(merged), contract.attributes.shares),
                call.leg('in', toAsset(denomToAsset('x/ruji')), contract.attributes.amount),
            ], {});
        }
        case 'wasm-crank-fee':
            // Levana perps is discontinued, and a position closes in a tx the wallet did not sign (not in Midgard),
            // so positions are entered by hand (rujira.md)
            if (contract.attributes.levana_protocol !== 'perps') {
                throw new Error(`rujira: unsupported contract ${contract.contractType}`);
            }

            return {activities: [], issues: [{kind: 'manual', message: `Levana perps position; ${call.txid}`}]};
        default:
            throw new Error(`rujira: unsupported contract ${contract.contractType}`);
    }
}

// A merge pool position, counted in pool shares
function mergeAsset(merged: string): Asset {
    return {notation: merged, kind: 'position', position: 'merge'};
}

function ignored(message: string): Result {
    return {activities: [], issues: [{kind: 'ignored', message}]};
}

// One wasm call made by the wallet, with the Cosmos tx that holds its results and gas
class Call {
    readonly wallet: string;
    readonly txid: string;
    private readonly cosmosTx?: CosmosTx;

    constructor(private bundle: RawBundle, private action: Action, private contract: Contract, private protocol: Protocol) {
        this.wallet = action.in[0].address;
        this.txid = action.in[0].txID ?? '';
        this.cosmosTx = bundle.cosmosTxs.find(tx => tx.txhash === this.txid);
    }

    leg(direction: Leg['direction'], asset: Asset, amount: string, role: Leg['role'] = 'principal'): Leg {
        return {direction, wallet: this.wallet, asset, amount: parseAmount(amount, DECIMALS), role, basis: 'observed', txid: this.txid};
    }

    // The one coin the wallet sent with the call
    fundsLeg(): Leg {
        const coins = parseCoins(this.contract.funds ?? '');

        if (coins.length !== 1) {
            throw new Error(`rujira: expected one coin in funds, got ${this.contract.funds}`);
        }

        return this.leg('out', toAsset(denomToAsset(coins[0].denom)), coins[0].amount);
    }

    // A FIN market swap: the output, net of FIN's fee, is only in the Cosmos tx
    finTrade(): Result {
        const isSwap = !!this.contract.msg?.swap;

        if (this.action.out[0]?.address !== this.calledContract()) {
            if (isSwap) {
                // e.g. a swap routed through several FIN pairs: each pair's trade would repeat the output
                throw new Error('rujira: FIN trade in a swap sent to another contract is not supported');
            }

            return ignored('FIN trade made by the called contract itself, e.g. a staking contract selling its revenue');
        }

        const sent = parseCoins(this.contract.funds ?? '');

        if (sent.length !== 1) {
            throw new Error(`rujira: expected one coin sent to FIN, got ${this.contract.funds}`);
        }

        const received = this.received();
        const returned = received.filter(coin => coin.denom === sent[0].denom).reduce((sum, coin) => sum + BigInt(coin.amount), 0n);
        const output = received.filter(coin => coin.denom !== sent[0].denom);

        if (output.length !== 1) {
            throw new Error(`rujira: expected one coin received from FIN, got ${JSON.stringify(output)}`);
        }

        const sentAsset = toAsset(denomToAsset(sent[0].denom));

        return this.result('rujira.fin.trade', [
            this.leg('out', sentAsset, sent[0].amount),
            ...(returned > 0n ? [this.leg('in', sentAsset, returned.toString(), 'returned')] : []),
            this.leg('in', toAsset(denomToAsset(output[0].denom)), output[0].amount),
        ], {});
    }

    result(kind: Activity['kind'], legs: Leg[], details: Record<string, string | undefined>): Result {
        const gas = this.gas();

        return {
            activities: [{
                id: getBundleKey(this.bundle),
                protocol: this.protocol.id,
                kind,
                status: this.action.status as Activity['status'],
                time: getActionDate(this.action),
                txids: getTxids(this.action),
                legs: gas ? [...legs, gas] : legs,
                prices: [],
                details: Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)) as Record<string, string>,
            }],
            issues: [],
        };
    }

    // The gas of the wasm call, from the Cosmos tx; none without it or when none was paid. Not THORChain's
    // 0.02 RUNE native fee (rujira.md).
    private gas(): Leg | undefined {
        const fee = this.cosmosTx?.fee.find(coin => coin.denom === 'rune' && BigInt(coin.amount) > 0n);
        return fee ? this.leg('out', toAsset(this.protocol.nativeAsset), fee.amount, 'gas') : undefined;
    }

    // The contract the wallet called: the first one executed in the Cosmos tx
    private calledContract(): string | undefined {
        return this.requireCosmosTx().events
            .find(event => event.type === 'execute')?.attributes
            .find(attribute => attribute.key === '_contract_address')?.value;
    }

    private requireCosmosTx(): CosmosTx {
        if (!this.cosmosTx) {
            throw new Error(`rujira: no Cosmos tx for ${this.txid}`);
        }

        return this.cosmosTx;
    }

    // Coins transferred to the wallet in the Cosmos tx
    private received(): Coin[] {
        return this.requireCosmosTx().events
            .filter(event => event.type === 'transfer')
            .map(event => Object.fromEntries(event.attributes.map(({key, value}) => [key, value])))
            .filter(attributes => attributes.recipient === this.wallet)
            .flatMap(attributes => parseCoins(attributes.amount));
    }
}
