import {UnbondMapper} from '../src/cryptotax-thorchain/UnbondMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('UnbondMapper', () => {
    let unbondMapper: UnbondMapper;

    test('should correctly map an unbond action', () => {
        const action = fs.readJSONSync('test/testdata/Unbond.json');

        unbondMapper = new UnbondMapper();
        const result = unbondMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.StakingWithdrawal,
            baseCurrency: 'RUNE',
            baseAmount: '5000',
            feeCurrency: 'RUNE',
            feeAmount: '0.02',
            from: 'thorchain',
            to: 'thor1-user-wallet-11111',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.unbond',
            description: '1/1 - Unbond 5000 RUNE from thor1-node-address; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });
});
