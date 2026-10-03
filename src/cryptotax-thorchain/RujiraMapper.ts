import {Action} from '@xchainjs/xchain-midgard';
import {TxStatusResponse} from '@xchainjs/xchain-thornode';
import {CryptoTaxTransaction, CryptoTaxTransactionType} from '../cryptotax';
import {baseToAssetAmountString} from '../utils/Amount';
import {Protocol, THORCHAIN} from '../protocols/Protocol';
import {Mapper} from './Mapper';
import {CosmosTx} from './CosmosTxService';
import {parseMidgardAsset, parseMidgardDate} from './MidgardUtils';
import {formatBlockchainForOutput} from './ThorchainUtils';

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
// Only the event of the call the wallet made is mapped; these events happen inside it and give no rows.
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

interface Coin {
    denom: string;
    amount: string;
}

interface Contract {
    contractType: string;
    funds?: string;
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
function denomToAsset(denom: string): string {
    return denom === 'rune' ? 'THOR.RUNE' : denom.toUpperCase();
}

export class RujiraMapper implements Mapper {
    private action!: Action;
    private contract!: Contract;
    private cosmosTx?: CosmosTx;
    private protocol: Protocol = THORCHAIN;
    private wallet = '';
    private txId = '';
    private timestamp = '';

    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[] = [], protocol: Protocol = THORCHAIN,
                cosmosTxs: CosmosTx[] = []): CryptoTaxTransaction[] {
        this.action = action;
        this.contract = (action.metadata as any).contract;
        this.protocol = protocol;
        this.wallet = action.in[0].address;
        this.txId = action.in[0].txID ?? '';
        this.cosmosTx = cosmosTxs.find(tx => tx.txhash === this.txId);
        this.timestamp = parseMidgardDate(action.date).toISOString();

        if (INNER_EVENTS.includes(this.contract.contractType)) {
            return [];
        }

        // An event raised inside another call carries that call's message and funds, so it can't be mapped alone
        const expectedMsg = PRIMARY_MSGS[this.contract.contractType];

        if (expectedMsg && !expectedMsg((this.contract as any).msg ?? {})) {
            throw new Error(`RujiraMapper: ${this.contract.contractType} inside another call (${JSON.stringify((this.contract as any).msg)}) is not supported`);
        }

        switch (this.contract.contractType) {
            case 'wasm-rujira-staking/liquid.bond':
                return [this.bond('liquid-bond', 'Liquid bond', ` for ${this.amount(this.contract.attributes.shares)} shares`)];
            case 'wasm-rujira-staking/account.bond':
                return [this.bond('account-bond', 'Account bond', '')];
            case 'wasm-rujira-fin/trade':
                return this.finTrade();
            case 'wasm-rujira-merge/deposit':
                return this.mergeDeposit();
            case 'wasm-rujira-merge/withdraw':
                return this.mergeWithdraw();
            case 'wasm-crank-fee':
                return this.levana();
            default:
                throw new Error(`RujiraMapper: unsupported contract ${this.contract.contractType}`);
        }
    }

    private bond(idSuffix: string, label: string, note: string): CryptoTaxTransaction {
        const funds = this.funds();

        return {
            walletExchange: this.wallet,
            timestamp: this.timestamp,
            type: CryptoTaxTransactionType.StakingDeposit,
            baseCurrency: funds.currency,
            baseAmount: funds.amount,
            ...this.fee(),
            from: this.wallet,
            to: this.protocol.counterparty,
            blockchain: this.blockchain(),
            id: `${this.timestamp}.rujira-${idSuffix}`,
            description: `1/1 - Rujira ${label} ${funds.amount} ${funds.displayCurrency}${note}; ${this.txId}`,
        };
    }

    // A FIN market swap: the output, net of FIN's fee, is only in the Cosmos tx
    private finTrade(): CryptoTaxTransaction[] {
        const isSwap = !!(this.contract as any).msg?.swap;

        if (this.action.out[0]?.address !== this.calledContract()) {
            if (isSwap) {
                // e.g. a swap routed through several FIN pairs: each pair's trade would repeat the output
                throw new Error('RujiraMapper: FIN trade in a swap sent to another contract is not supported');
            }

            // A trade the called contract made itself, e.g. a staking contract selling its revenue
            return [];
        }

        const sent = parseCoins(this.contract.funds ?? '');

        if (sent.length !== 1) {
            throw new Error(`RujiraMapper: expected one coin sent to FIN, got ${this.contract.funds}`);
        }

        const received = this.received();
        const returned = received.filter(coin => coin.denom === sent[0].denom);
        const output = received.filter(coin => coin.denom !== sent[0].denom);

        if (output.length !== 1) {
            throw new Error(`RujiraMapper: expected one coin received from FIN, got ${JSON.stringify(output)}`);
        }

        const returnedAmount = returned.reduce((sum, coin) => sum + BigInt(coin.amount), 0n);
        const input = this.coin(sent[0].denom, (BigInt(sent[0].amount) - returnedAmount).toString());
        const out = this.coin(output[0].denom, output[0].amount);

        return this.trade('fin', 'FIN swap', input, out);
    }

    // Merging is one-way, so the deposit disposes of the asset for a position in the merge pool
    private mergeDeposit(): CryptoTaxTransaction[] {
        const funds = this.funds();
        const position = this.mergePosition(denomToAsset(this.funds().denom), this.contract.attributes.shares);

        return this.trade('merge-deposit', 'Merge deposit', funds, position);
    }

    private mergeWithdraw(): CryptoTaxTransaction[] {
        const contract = this.action.out[0]?.address ?? '';
        const mergeAsset = MERGE_POOLS[contract];

        if (!mergeAsset) {
            throw new Error(`RujiraMapper: unknown merge pool ${contract}`);
        }

        const position = this.mergePosition(mergeAsset, this.contract.attributes.shares);
        const ruji = this.coin('x/ruji', this.contract.attributes.amount);

        return this.trade('merge-withdraw', 'Merge withdraw', position, ruji);
    }

    // Levana perps is discontinued, and a position closes in a tx the wallet did not sign (not in Midgard),
    // so positions are entered by hand. See docs/specs/rujira.md.
    private levana(): CryptoTaxTransaction[] {
        if (this.contract.attributes.levana_protocol !== 'perps') {
            throw new Error(`RujiraMapper: unsupported contract ${this.contract.contractType}`);
        }

        console.log(`${this.timestamp} Levana perps: enter by hand; ${this.txId}`);
        return [];
    }

    private trade(idSuffix: string, label: string, input: ParsedCoin, output: ParsedCoin): CryptoTaxTransaction[] {
        const description = `Rujira ${label} ${input.amount} ${input.displayCurrency} to ${output.amount} ${output.displayCurrency}; ${this.txId}`;
        const timestampPlus10 = new Date(new Date(this.timestamp).getTime() + 10 * 1000).toISOString();

        return [
            {
                walletExchange: this.wallet,
                timestamp: this.timestamp,
                type: CryptoTaxTransactionType.BridgeTradeOut,
                baseCurrency: input.currency,
                baseAmount: input.amount,
                quoteCurrency: output.currency,
                quoteAmount: output.amount,
                ...this.fee(),
                from: this.wallet,
                to: this.protocol.counterparty,
                blockchain: this.blockchain(),
                id: `${this.timestamp}.rujira-${idSuffix}.bridge-trade-out`,
                description: `1/2 - ${description}`,
            },
            {
                walletExchange: this.wallet,
                timestamp: timestampPlus10,
                type: CryptoTaxTransactionType.BridgeTradeIn,
                baseCurrency: output.currency,
                baseAmount: output.amount,
                from: this.protocol.counterparty,
                to: this.wallet,
                blockchain: this.blockchain(),
                id: `${this.timestamp}.rujira-${idSuffix}.bridge-trade-in`,
                description: `2/2 - ${description}`,
            },
        ];
    }

    // The position in a merge pool, e.g. RujiraMerge.THOR.KUJI, counted in pool shares
    private mergePosition(mergeAsset: string, shares: string): ParsedCoin {
        const {currency, displayCurrency} = parseMidgardAsset(mergeAsset, this.protocol);
        const name = `RujiraMerge.${this.protocol.nativeChain}.${currency}`;

        return {currency: name, displayCurrency: `${displayCurrency} merge shares`, amount: this.amount(shares)};
    }

    private funds(): ParsedCoin & Coin {
        const coins = parseCoins(this.contract.funds ?? '');

        if (coins.length !== 1) {
            throw new Error(`RujiraMapper: expected one coin in funds, got ${this.contract.funds}`);
        }

        return {...coins[0], ...this.coin(coins[0].denom, coins[0].amount)};
    }

    private coin(denom: string, amount: string): ParsedCoin {
        const {currency, displayCurrency} = parseMidgardAsset(denomToAsset(denom), this.protocol);
        return {currency, displayCurrency, amount: this.amount(amount)};
    }

    private amount(amount: string): string {
        return baseToAssetAmountString(amount);
    }

    // The contract the wallet called: the first one executed in the Cosmos tx
    private calledContract(): string | undefined {
        return this.requireCosmosTx().events
            .find(event => event.type === 'execute')?.attributes
            .find(attribute => attribute.key === '_contract_address')?.value;
    }

    private requireCosmosTx(): CosmosTx {
        if (!this.cosmosTx) {
            throw new Error(`RujiraMapper: no Cosmos tx for ${this.txId}`);
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

    // The gas of the wasm call, from the Cosmos tx; blank without it or when none was paid. Not THORChain's 0.02 RUNE native fee.
    private fee(): {feeCurrency?: string, feeAmount?: string} {
        const fee = this.cosmosTx?.fee.find(coin => coin.denom === 'rune' && BigInt(coin.amount) > 0n);
        return fee ? {feeCurrency: 'RUNE', feeAmount: this.amount(fee.amount)} : {};
    }

    private blockchain(): string {
        return formatBlockchainForOutput(this.protocol.nativeChain);
    }
}

interface ParsedCoin {
    currency: string;
    displayCurrency: string;
    amount: string;
}
