import {mapAction} from "./mapAction";
import fs from 'fs-extra';
import {describe, expect, test} from '@jest/globals';

describe('LoanOpen', () => {
    test('Deposit BTC, borrow RUNE. No affiliate fee', () => {
        const action = fs.readJSONSync('test/testdata/LoanOpen_Deposit_BTC_borrow_RUNE.json');
        const txs = mapAction(action);

        expect(txs.length).toBe(2);

        expect(txs[0]).toStrictEqual({
            walletExchange: 'bc1-user-wallet-aaaaa',
            timestamp: new Date('2020-12-31T13:00:00.000Z'),
            type: 'collateral-deposit',
            baseCurrency: 'BTC',
            baseAmount: '1.23',
            feeCurrency: '',
            feeAmount: '',
            from: 'bc1-user-wallet-aaaaa',
            to: 'thorchain',
            blockchain: 'BTC',
            id: '2020-12-31T13:00:00.000Z.collateral-deposit',
            description: '1/2 - LoanOpen deposit BTC to borrow RUNE; ' +
                '0000000000000000000000000000000000000000000000000000000000000000'
        });

        expect(txs[1]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: new Date('2020-12-31T13:00:00.000Z'),
            type: 'loan',
            baseCurrency: 'RUNE',
            baseAmount: '4000',
            from: 'thorchain',
            to: 'thor1-user-wallet-11111',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.loan',
            description: '2/2 - LoanOpen deposit BTC to borrow RUNE; ' +
                '0000000000000000000000000000000000000000000000000000000000000000'
        });
    });

    test('Deposit BTC, borrow RUNE. With affiliate fee', () => {
        const action = fs.readJSONSync('test/testdata/LoanOpen_Deposit_BTC_borrow_RUNE_Affiliate_Fee.json');
        const txs = mapAction(action);

        expect(txs.length).toBe(2);

        expect(txs[0]).toStrictEqual({
            walletExchange: 'bc1-user-wallet-aaaaa',
            timestamp: new Date('2020-12-31T13:00:00.000Z'),
            type: 'collateral-deposit',
            baseCurrency: 'BTC',
            baseAmount: '1.23',
            feeCurrency: '',
            feeAmount: '',
            from: 'bc1-user-wallet-aaaaa',
            to: 'thorchain',
            blockchain: 'BTC',
            id: '2020-12-31T13:00:00.000Z.collateral-deposit',
            description: '1/2 - LoanOpen deposit BTC to borrow RUNE; ' +
                '0000000000000000000000000000000000000000000000000000000000000000'
        });

        expect(txs[1]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: new Date('2020-12-31T13:00:00.000Z'),
            type: 'loan',
            baseCurrency: 'RUNE',
            baseAmount: '4000',
            from: 'thorchain',
            to: 'thor1-user-wallet-11111',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.loan',
            description: '2/2 - LoanOpen deposit BTC to borrow RUNE; ' +
                '0000000000000000000000000000000000000000000000000000000000000000'
        });
    });
});
