import {Action, ActionTypeEnum as ActionType} from "@xchainjs/xchain-midgard";
import {CryptoTaxTransaction} from "../cryptotax";
import {Issue} from "../domain/Issue";
import {RawBundle} from "../sources/RawBundle";
import {Protocol, THORCHAIN} from "../protocols/Protocol";
import {ViewblockTx} from "../viewblock";
import {TcyDistributionItem} from "../cryptotax-thorchain/TcyDistributionService";
import {Mapper} from "../cryptotax-thorchain/Mapper";
import {interpretBond} from "./midgard/bond";
import {interpretSwap} from "./midgard/swap";
import {interpretRefund} from "./midgard/refund";
import {interpretAddLiquidity, interpretWithdraw} from "./midgard/liquidity";
import {interpretRunePool, interpretSwitch} from "./midgard/switch";
import {interpretLoanOpen, interpretLoanRepay} from "./midgard/loan";
import {Activity} from "../domain/Activity";
import {TcyClaimMapper} from "../cryptotax-thorchain/TcyClaimMapper";
import {TcyStakeMapper} from "../cryptotax-thorchain/TcyStakeMapper";
import {TcyUnstakeMapper} from "../cryptotax-thorchain/TcyUnstakeMapper";
import {ThornameMapper} from "../cryptotax-thorchain/ThornameMapper";
import {RUJIRA_CONTRACT_TYPES, RujiraMapper} from "../cryptotax-thorchain/RujiraMapper";
import {TcyDistributionMapper} from "../cryptotax-thorchain/TcyDistributionMapper";
import {SendMapper} from "../thorchain-exporter/SendMapper";
import {DelegateArkeoMapper} from "../thorchain-exporter/DelegateArkeoMapper";

// A ported action type gives activities, which an exporter turns into rows; the rest still give rows
export interface Interpretation {
    activities: Activity[];
    rows: CryptoTaxTransaction[];
    issues: Issue[];
}

// Turns one bundle into rows. Pure: no network, files, clock or logging; problems are returned as issues.
export type Interpreter = (bundle: RawBundle, protocol: Protocol) => Interpretation;

const rows = (rows: CryptoTaxTransaction[]): Interpretation => ({activities: [], rows, issues: []});
const activity = (interpreter: (bundle: RawBundle, protocol: Protocol) => Activity): Interpreter => (bundle, protocol) =>
    ({activities: [interpreter(bundle, protocol)], rows: [], issues: []});

// A Midgard mapper, made for each action so the issues it finds are that action's
const midgard = (make: (bundle: RawBundle, protocol: Protocol) => Mapper): Interpreter => (bundle, protocol) => {
    const mapper = make(bundle, protocol);
    const rows = mapper.toCryptoTax(bundle.data as Action, bundle.thornodeTxs, protocol, bundle.cosmosTxs);
    return {activities: [], rows, issues: mapper.issues ?? []};
};

const ignore = (message: string): Interpreter => () => ({activities: [], rows: [], issues: [{kind: 'ignored', message}]});

const rujira = midgard(() => new RujiraMapper());

// Keyed on 'source/type' or 'source/type/subtype'; a subtype entry wins over its type's
const REGISTRY: Record<string, Interpreter> = {
    [`midgard/${ActionType.AddLiquidity}`]: (bundle, protocol) => ({rows: [], ...interpretAddLiquidity(bundle, protocol)}),
    [`midgard/${ActionType.Withdraw}`]: (bundle, protocol) => ({rows: [], ...interpretWithdraw(bundle, protocol)}),
    [`midgard/${ActionType.Swap}`]: (bundle, protocol) => ({rows: [], ...interpretSwap(bundle, protocol)}),
    [`midgard/${ActionType.Swap}/loanOpen`]: activity(interpretLoanOpen),
    [`midgard/${ActionType.Swap}/loanRepayment`]: activity(interpretLoanRepay),
    [`midgard/${ActionType.Refund}`]: (bundle, protocol) => ({rows: [], ...interpretRefund(bundle, protocol)}),
    [`midgard/${ActionType.Switch}`]: activity(interpretSwitch),
    [`midgard/${ActionType.Thorname}`]: midgard(() => new ThornameMapper()),
    [`midgard/${ActionType.RunePoolDeposit}`]: activity(interpretRunePool),
    [`midgard/${ActionType.RunePoolWithdraw}`]: activity(interpretRunePool),
    'midgard/bond': activity(interpretBond),
    'midgard/unbond': activity(interpretBond),
    'midgard/tcy_claim': midgard(() => new TcyClaimMapper()),
    'midgard/tcy_stake': midgard(() => new TcyStakeMapper()),
    'midgard/tcy_unstake': midgard(() => new TcyUnstakeMapper()),
    [`midgard/${ActionType.Send}`]: ignore('Midgard send: sends come from Viewblock'),
    ...Object.fromEntries(RUJIRA_CONTRACT_TYPES.map(type => [`midgard/contract/${type}`, rujira])),
    'viewblock/send': bundle => rows(new SendMapper(bundle.data as ViewblockTx, bundle.wallet).toCtc()),
    'viewblock/send/delegate-arkeo': bundle => rows(new DelegateArkeoMapper(bundle.data as ViewblockTx, bundle.wallet).toCtc()),
    // Only sends are taken from Viewblock; every other action comes from Midgard
    'viewblock/other': ignore('Viewblock tx other than a send'),
    'tcy/distribution': bundle => rows(new TcyDistributionMapper(bundle.data as TcyDistributionItem, bundle.wallet).toCtc()),
};

// Midgard action types handled on protocols other than THORChain (see docs/specs/maya.md)
const NON_THORCHAIN_ACTION_TYPES: string[] = [ActionType.Swap, ActionType.AddLiquidity, ActionType.Withdraw, ActionType.Refund, ActionType.Send];

export function getBundleType(bundle: RawBundle): {type: string; subtype?: string} {
    switch (bundle.source) {
        case 'midgard': {
            const action = bundle.data as Action;

            if (action.type === ActionType.Swap) {
                const txType = (action.metadata.swap as any)?.txType;
                // Some loan opens show as a noOp swap from TOR, the swap output being the loan
                const isLoanOpen = txType === 'noOp' && action.in[0].coins[0].asset === 'THOR.TOR';
                return {type: action.type, subtype: isLoanOpen ? 'loanOpen' : txType};
            }

            if (action.type as string === 'contract') {
                return {type: action.type, subtype: (action.metadata as any).contract?.contractType};
            }

            return {type: action.type};
        }
        case 'viewblock': {
            const tx = bundle.data as ViewblockTx;

            if (!tx.types.includes('send')) {
                return {type: 'other'};
            }

            return {type: 'send', subtype: (tx.memo || '').startsWith('delegate:arkeo:') ? 'delegate-arkeo' : undefined};
        }
        case 'tcy':
            return {type: 'distribution'};
    }
}

export function findInterpreter(bundle: RawBundle, protocol: Protocol): Interpreter | undefined {
    const {type, subtype} = getBundleType(bundle);

    if (bundle.source === 'midgard' && protocol.id !== THORCHAIN.id && !NON_THORCHAIN_ACTION_TYPES.includes(type)) {
        return undefined;
    }

    return (subtype !== undefined ? REGISTRY[`${bundle.source}/${type}/${subtype}`] : undefined)
        ?? REGISTRY[`${bundle.source}/${type}`];
}

export function interpret(bundle: RawBundle, protocol: Protocol): Interpretation {
    try {
        const interpreter = findInterpreter(bundle, protocol);

        if (!interpreter) {
            const {type, subtype} = getBundleType(bundle);
            return {activities: [], rows: [], issues: [{kind: 'unsupported', message: `unsupported action: ${[type, subtype].filter(Boolean).join(' ')}`}]};
        }

        return interpreter(bundle, protocol);
    } catch (e: any) {
        return {activities: [], rows: [], issues: [{kind: 'failed', message: failureMessage(bundle, protocol, e)}]};
    }
}

function failureMessage(bundle: RawBundle, protocol: Protocol, e: any): string {
    const message = e?.message || 'unknown error';

    if (bundle.source !== 'midgard') {
        return message;
    }

    const action = bundle.data as Action;
    const txId = action.in?.[0]?.txID || 'unknown';
    return `[${protocol.id === THORCHAIN.id ? 'Midgard' : protocol.id + ' Midgard'}] ${message}. type: ${action.type}, txid: ${txId}`;
}
