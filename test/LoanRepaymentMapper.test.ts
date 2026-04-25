import {LoanRepaymentMapper} from "../src/cryptotax-thorchain/LoanRepaymentMapper";
import fs from 'fs-extra';
import {describe, expect, test} from '@jest/globals';
const mapper = new LoanRepaymentMapper();

describe('LoanRepaymentMapper', () => {
    test('Deposit BTC to repay BTC loan. No closure', () => {
        const action = fs.readJSONSync('test/testdata/LoanRepayment_Deposit_BTC_to_repay_BTC_loan_No_closure.json');
        const txs = mapper.toCryptoTax(action, false);

        expect(txs.length).toBe(1);

        expect(txs[0]).toStrictEqual({
            walletExchange: 'bc1-user-wallet-aaaaa',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: 'loan-repayment',
            baseCurrency: 'BTC',
            baseAmount: '0.05',
            feeCurrency: 'RUNE',
            feeAmount: '0.11111111',
            from: 'bc1-user-wallet-aaaaa',
            to: 'thorchain',
            blockchain: 'BTC',
            id: '2020-12-31T13:00:00.000Z.loan-repayment',
            description: '1/1 - LoanRepayment deposit BTC to repay BTC loan. No closure; ' +
                '0000000000000000000000000000000000000000000000000000000000000000'
        });
    });

    test('Deposit RUNE to repay BTC loan. Closed loan', () => {
        const action = fs.readJSONSync('test/testdata/LoanRepayment_Deposit_RUNE_to_repay_BTC_loan_Closed_loan.json');
        const txs = mapper.toCryptoTax(action, false);

        expect(txs.length).toBe(2);

        expect(txs[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: 'loan-repayment',
            baseCurrency: 'RUNE',
            baseAmount: '2',
            feeCurrency: 'RUNE',
            feeAmount: '0.000001',
            from: 'thor1-user-wallet-11111',
            to: 'thorchain',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.loan-repayment',
            description: '1/2 - LoanRepayment deposit RUNE to repay BTC loan. Closed loan; ' +
                '0000000000000000000000000000000000000000000000000000000000000000'
        });

        expect(txs[1]).toStrictEqual({
            walletExchange: 'bc1-user-wallet-aaaaa',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: 'collateral-withdrawal',
            baseCurrency: 'BTC',
            baseAmount: '1.23',
            feeCurrency: 'BTC',
            feeAmount: '0.0005',
            from: 'thorchain',
            to: 'bc1-user-wallet-aaaaa',
            blockchain: 'BTC',
            id: '2020-12-31T13:00:00.000Z.collateral-withdrawal',
            description: '2/2 - LoanRepayment deposit RUNE to repay BTC loan. Closed loan; ' +
                '0000000000000000000000000000000000000000000000000000000000000000'
        });
    });
});
