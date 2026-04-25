import {TcyUnstakeMapper} from '../src/cryptotax-thorchain/TcyUnstakeMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('TcyUnstakeMapper', () => {
    let tcyUnstakeMapper: TcyUnstakeMapper;

    test('should correctly map a tcy_unstake action', () => {
        const action = fs.readJSONSync('test/testdata/TcyUnstake.json');

        tcyUnstakeMapper = new TcyUnstakeMapper();
        const result = tcyUnstakeMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.StakingWithdrawal,
            baseCurrency: 'TCY',
            baseAmount: '6000',
            from: 'thorchain',
            to: 'thor1-user-wallet-11111',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.tcy_unstake',
            description: '1/1 - Unstake 6000 TCY; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });
});
