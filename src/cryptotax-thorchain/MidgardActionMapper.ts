import { Action, ActionTypeEnum as ActionType } from "@xchainjs/xchain-midgard";
import { CryptoTaxTransaction } from "../cryptotax";
import { parseMidgardDate } from "./MidgardUtils";
import { AddLiquidityMapper } from "./AddLiquidityMapper";
import { Mapper } from "./Mapper";
import { SwapMapper } from "./SwapMapper";
import { SwitchMapper } from "./SwitchMapper";
import { WithdrawMapper } from "./WithdrawMapper";
import { RefundMapper } from "./RefundMapper";
import {LoanOpenMapper} from "./LoanOpenMapper";
import {LoanRepaymentMapper} from "./LoanRepaymentMapper";
import {BondMapper} from "./BondMapper";
import {UnbondMapper} from "./UnbondMapper";
import {TcyClaimMapper} from "./TcyClaimMapper";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import { writeFileSync, mkdirSync } from "fs";
import * as path from "path";
import {TcyStakeMapper} from "./TcyStakeMapper";
import {RunePoolDepositMapper} from "./RunePoolDepositMapper";
import {RunePoolWithdrawMapper} from "./RunePoolWithdrawMapper";
import {ThornameMapper} from "./ThornameMapper";
import {RUJIRA_CONTRACT_TYPES, RujiraMapper} from "./RujiraMapper";
import {CosmosTx} from "./CosmosTxService";
import {TcyUnstakeMapper} from "./TcyUnstakeMapper";
import {Protocol, THORCHAIN} from "../protocols/Protocol";

type ActionMappers = {
    [index in ActionType | string]: Mapper | null | any;
}

const actionMappers: ActionMappers = {
    [ActionType.AddLiquidity]: new AddLiquidityMapper(),
    [ActionType.Donate]: null,
    [ActionType.Send]: null,
    [ActionType.Thorname]: new ThornameMapper(),
    [ActionType.RunePoolDeposit]: new RunePoolDepositMapper(),
    [ActionType.RunePoolWithdraw]: new RunePoolWithdrawMapper(),
    [ActionType.Refund]: new RefundMapper(),
    [ActionType.Swap]: SwapMapper,
    [ActionType.Switch]: new SwitchMapper(),
    [ActionType.Withdraw]: new WithdrawMapper(),
    'bond': new BondMapper(),
    'unbond': new UnbondMapper(),
    'tcy_claim': new TcyClaimMapper(),
    'tcy_stake': new TcyStakeMapper(),
    'tcy_unstake': new TcyUnstakeMapper()
}

const loanOpenMapper = new LoanOpenMapper();
const loanRepaymentMapper = new LoanRepaymentMapper();

export function getActionDate(action: Action): Date {
    return parseMidgardDate(action.date);
}

// Action types mapped on protocols other than THORChain (see docs/specs/maya.md)
const NON_THORCHAIN_ACTION_TYPES: string[] = [ActionType.Swap, ActionType.AddLiquidity, ActionType.Withdraw, ActionType.Refund];

export function actionToCryptoTax(action: Action, thornodeTxs: TxStatusResponse[], addReferencePrices: boolean = false, unsupportedActionsPath: string,
                                  protocol: Protocol = THORCHAIN, cosmosTxs: CosmosTx[] = []): CryptoTaxTransaction[] {
    const date: string = getActionDate(action).toISOString();
    let mapper = protocol.id === THORCHAIN.id || NON_THORCHAIN_ACTION_TYPES.includes(action.type) ? getMapper(action) : null;

    try {
        if (typeof mapper === 'function') {
            mapper = new (mapper as any)(action, addReferencePrices, thornodeTxs, protocol);
        }

        const transactions: CryptoTaxTransaction[] = mapper?.toCryptoTax(action, addReferencePrices, thornodeTxs, protocol, cosmosTxs) ?? [];

        if (mapper) {
            console.log(`${date} ${action.type}: ${transactions.length}`);
        } else {
            if (action.type as string !== 'send') {
                console.error(`${date} ${action.type}: unsupported action`);

                // Write unsupported action to JSON
                const txId = action.in?.[0]?.txID;
                const filename = (txId ? txId : date) + '.json';
                const protocolDir = protocol.id === THORCHAIN.id ? '' : protocol.id;
                const filePath = path.join(unsupportedActionsPath, protocolDir, action.type, filename);
                mkdirSync(path.dirname(filePath), {recursive: true});
                writeFileSync(filePath, JSON.stringify(action, null, 4));
            }
        }

        return transactions;

    } catch (e: any) {
        const txId = action.in?.[0]?.txID || 'unknown';
        throw new Error(`[${protocol.id === THORCHAIN.id ? 'Midgard' : protocol.id + ' Midgard'}] ${e.message || 'unknown error'}. type: ${action.type}, txid: ${txId}`);
    }
}

function getMapper(action: Action): Mapper | null {
    let mapper: Mapper | null = actionMappers[action.type];

    const actionType = action.type as string;

    if (actionType === 'swap') {
        const txType = (action.metadata.swap as any)?.txType;

        if (txType === 'loanOpen') {
            mapper = loanOpenMapper;
        } else if (txType === 'loanRepayment') {
            mapper = loanRepaymentMapper;
        } else if (txType === 'noOp' && action.in[0].coins[0].asset === 'THOR.TOR') {
            // Some loan open shows as a noOp swap from midgard
            // With the swap output being the loan
            mapper = loanOpenMapper;
        }
    } else if (actionType === 'contract') {
        const contractType = (action.metadata as any).contract?.contractType;

        if (RUJIRA_CONTRACT_TYPES.includes(contractType)) {
            mapper = new RujiraMapper();
        }
    }

    return mapper;
}
