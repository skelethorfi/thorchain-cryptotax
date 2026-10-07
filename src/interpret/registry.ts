import {Action, ActionTypeEnum as ActionType} from "@xchainjs/xchain-midgard";
import {CryptoTaxTransaction} from "../export/summ/csv";
import {Issue} from "../domain/Issue";
import {RawBundle} from "../sources/RawBundle";
import {Protocol, THORCHAIN} from "../domain/Protocol";
import {interpretBond} from "./midgard/bond";
import {interpretSwap} from "./midgard/swap";
import {interpretRefund} from "./midgard/refund";
import {interpretAddLiquidity, interpretWithdraw} from "./midgard/liquidity";
import {interpretRunePool, interpretSwitch} from "./midgard/switch";
import {interpretLoanOpen, interpretLoanRepay} from "./midgard/loan";
import {interpretTcyClaim, interpretTcyDistribution, interpretTcyStake, interpretThorname} from "./midgard/tcy";
import {Activity} from "../domain/Activity";
import {interpretRujira, RUJIRA_CONTRACT_TYPES} from "./midgard/rujira";
import {interpretSend} from "./midgard/send";
import {interpretViewblockSend} from "./viewblock/send";

// A ported action type gives activities, which an exporter turns into rows; the rest still give rows
export interface Interpretation {
    activities: Activity[];
    rows: CryptoTaxTransaction[];
    issues: Issue[];
}

// Turns one bundle into rows. Pure: no network, files, clock or logging; problems are returned as issues.
export type Interpreter = (bundle: RawBundle, protocol: Protocol) => Interpretation;

const activity = (interpreter: (bundle: RawBundle, protocol: Protocol) => Activity): Interpreter => (bundle, protocol) =>
    ({activities: [interpreter(bundle, protocol)], rows: [], issues: []});

const ignore = (message: string): Interpreter => () => ({activities: [], rows: [], issues: [{kind: 'ignored', message}]});

const rujira: Interpreter = (bundle, protocol) => ({rows: [], ...interpretRujira(bundle, protocol)});

// Keyed on 'source/type' or 'source/type/subtype'; a subtype entry wins over its type's
const REGISTRY: Record<string, Interpreter> = {
    [`midgard/${ActionType.AddLiquidity}`]: (bundle, protocol) => ({rows: [], ...interpretAddLiquidity(bundle, protocol)}),
    [`midgard/${ActionType.Withdraw}`]: (bundle, protocol) => ({rows: [], ...interpretWithdraw(bundle, protocol)}),
    [`midgard/${ActionType.Swap}`]: (bundle, protocol) => ({rows: [], ...interpretSwap(bundle, protocol)}),
    [`midgard/${ActionType.Swap}/loanOpen`]: activity(interpretLoanOpen),
    [`midgard/${ActionType.Swap}/loanRepayment`]: activity(interpretLoanRepay),
    [`midgard/${ActionType.Refund}`]: (bundle, protocol) => ({rows: [], ...interpretRefund(bundle, protocol)}),
    [`midgard/${ActionType.Switch}`]: activity(interpretSwitch),
    [`midgard/${ActionType.Thorname}`]: activity(interpretThorname),
    [`midgard/${ActionType.RunePoolDeposit}`]: activity(interpretRunePool),
    [`midgard/${ActionType.RunePoolWithdraw}`]: activity(interpretRunePool),
    'midgard/bond': activity(interpretBond),
    'midgard/unbond': activity(interpretBond),
    'midgard/tcy_claim': activity(interpretTcyClaim),
    'midgard/tcy_stake': activity(interpretTcyStake),
    'midgard/tcy_unstake': activity(interpretTcyStake),
    // Maya sends (MAYA, CACAO) are not mapped yet (docs/specs/maya.md)
    [`midgard/${ActionType.Send}`]: (bundle, protocol) => protocol.id === THORCHAIN.id
        ? {rows: [], ...interpretSend(bundle, protocol)}
        : ignore('Maya send')(bundle, protocol),
    ...Object.fromEntries(RUJIRA_CONTRACT_TYPES.map(type => [`midgard/contract/${type}`, rujira])),
    // Viewblock gives only sends from before 2022-04 that Midgard does not list (docs/specs/sends.md)
    'viewblock/send': (bundle, protocol) => ({rows: [], ...interpretViewblockSend(bundle, protocol)}),
    'tcy/distribution': activity(interpretTcyDistribution),
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
        case 'viewblock':
            return {type: 'send'};
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
