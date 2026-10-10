import type {Activity} from "../../domain/Activity.ts";
import {formatAmount} from "../../domain/Amount.ts";
import {type CryptoTaxTransaction, CryptoTaxTransactionType} from "./csv/index.ts";
import {parseMidgardAsset} from "../../sources/thorchain/MidgardUtils.ts";
import {formatBlockchain, type Protocol} from "../../domain/Protocol.ts";
import {fee, findLeg, leg, legTrace, outboundNote} from "./common.ts";

// A loan open (docs/specs/loans.md): the collateral deposit carries the fee; the loan received has none
export function loanOpenRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const collateral = leg(activity, 'principal', 'out');
    const loan = leg(activity, 'principal', 'in');
    const input = parseMidgardAsset(collateral.asset.notation, protocol);
    const output = parseMidgardAsset(loan.asset.notation, protocol);
    const description = `LoanOpen deposit ${input.currency} to borrow ${output.currency}; ${collateral.txid ?? ''}`;
    const time = activity.time;

    return [
        {
            walletExchange: collateral.wallet,
            timestamp: time,
            type: CryptoTaxTransactionType.CollateralDeposit,
            baseCurrency: input.currency,
            baseAmount: formatAmount(collateral.amount),
            ...fee(activity, protocol),
            from: collateral.wallet,
            to: protocol.counterparty,
            blockchain: formatBlockchain(input.blockchain),
            trace: legTrace(collateral),
            description: `1/2 - ${description}`,
        },
        {
            walletExchange: loan.wallet,
            timestamp: time,
            type: CryptoTaxTransactionType.Loan,
            baseCurrency: output.currency,
            baseAmount: formatAmount(loan.amount),
            from: protocol.counterparty,
            to: loan.wallet,
            blockchain: formatBlockchain(output.blockchain),
            trace: legTrace(loan),
            description: `2/2 - ${description}${outboundNote(loan)}`,
        },
    ];
}

// A loan repayment carries the fee; when the loan closes, the collateral comes back with no fee
export function loanRepayRows(activity: Activity, protocol: Protocol): CryptoTaxTransaction[] {
    const repayment = leg(activity, 'principal', 'out');
    const collateralBack = findLeg(activity, 'principal', 'in');
    const input = parseMidgardAsset(repayment.asset.notation, protocol);
    const collateral = parseMidgardAsset(activity.details.collateral, protocol).currency;
    const closure = collateralBack ? 'Closed loan' : 'No closure';
    const txId = repayment.txid ?? '';
    const time = activity.time;
    const rows: CryptoTaxTransaction[] = [{
        walletExchange: repayment.wallet,
        timestamp: time,
        type: CryptoTaxTransactionType.LoanRepayment,
        baseCurrency: input.currency,
        baseAmount: formatAmount(repayment.amount),
        ...fee(activity, protocol),
        from: repayment.wallet,
        to: protocol.counterparty,
        blockchain: formatBlockchain(input.blockchain),
        trace: legTrace(repayment),
        description: `1/${collateralBack ? '2' : '1'} - LoanRepayment deposit ${input.currency} to repay ${collateral} loan. ${closure}; ${txId}`,
    }];

    if (collateralBack) {
        const output = parseMidgardAsset(collateralBack.asset.notation, protocol);

        rows.push({
            walletExchange: collateralBack.wallet,
            timestamp: time,
            type: CryptoTaxTransactionType.CollateralWithdrawal,
            baseCurrency: output.currency,
            baseAmount: formatAmount(collateralBack.amount),
            from: protocol.counterparty,
            to: collateralBack.wallet,
            blockchain: formatBlockchain(output.blockchain),
            trace: legTrace(collateralBack),
            description: `2/2 - LoanRepayment deposit ${input.currency} to repay ${collateral} loan. Closed loan; ${txId}${outboundNote(collateralBack)}`,
        });
    }

    return rows;
}
