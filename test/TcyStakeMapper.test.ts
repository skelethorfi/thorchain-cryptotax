import {TcyStakeMapper} from '../src/cryptotax-thorchain/TcyStakeMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('TcyStakeMapper', () => {
    let tcyStakeMapper: TcyStakeMapper;

    test('should correctly map a tcy_stake action', () => {
        const action = fs.readJSONSync('test/testdata/TcyStake.json');

        tcyStakeMapper = new TcyStakeMapper();
        const result = tcyStakeMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.StakingDeposit,
            baseCurrency: 'TCY',
            baseAmount: '9999.5555',
            from: 'thor1-user-wallet-11111',
            to: 'thorchain',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.tcy_stake',
            description: '1/1 - Stake 9999.5555 TCY; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });
});
