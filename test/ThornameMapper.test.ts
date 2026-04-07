import {ThornameMapper} from '../src/cryptotax-thorchain/ThornameMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('ThornameMapper', () => {
    let thornameMapper: ThornameMapper;

    test('should correctly map a thorname action', () => {
        const action = fs.readJSONSync('test/testdata/Thorname.json');

        thornameMapper = new ThornameMapper();
        const result = thornameMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.Expense,
            baseCurrency: 'RUNE',
            baseAmount: '50',
            feeCurrency: 'RUNE',
            feeAmount: '0.02',
            from: 'thor1-user-wallet-11111',
            to: 'thorchain',
            blockchain: 'THOR',
            id: '2020-12-31T13:00:00.000Z.thorname',
            description: '1/1 - Register/fund Thorname with 50 RUNE; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });

    test('should correctly map a thorname update', () => {
        const action = fs.readJSONSync('test/testdata/Thorname.json');

        // Thorname update has no coins. No cost other than gas fee.
        action.in[0].coins = [];

        thornameMapper = new ThornameMapper();
        const result = thornameMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.Expense,
            baseCurrency: '',
            baseAmount: '',
            feeCurrency: 'RUNE',
            feeAmount: '0.02',
            from: 'thor1-user-wallet-11111',
            to: 'thorchain',
            blockchain: 'THOR',
            id: '2020-12-31T13:00:00.000Z.thorname',
            description: '1/1 - Update Thorname; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });

    test('should fallback to thorname owner when input address is missing', () => {
        const action = fs.readJSONSync('test/testdata/Thorname.json');

        action.in[0].address = '';
        action.in[0].coins = [];
        action.in[0].txID = '';
        action.metadata.thorname.owner = 'thor1-owner-fallback-22222';

        thornameMapper = new ThornameMapper();
        const result = thornameMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-owner-fallback-22222',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.Expense,
            baseCurrency: '',
            baseAmount: '',
            feeCurrency: 'RUNE',
            feeAmount: '0.02',
            from: 'thor1-owner-fallback-22222',
            to: 'thorchain',
            blockchain: 'THOR',
            id: '2020-12-31T13:00:00.000Z.thorname',
            description: '1/1 - Update Thorname; ',
        });
    });
});
