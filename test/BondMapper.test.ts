import {BondMapper} from '../src/cryptotax-thorchain/BondMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('BondMapper', () => {
    let bondMapper: BondMapper;

    test('should correctly map a bond action', () => {
        const action = fs.readJSONSync('test/testdata/Bond.json');

        bondMapper = new BondMapper();
        const result = bondMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.StakingDeposit,
            baseCurrency: 'RUNE',
            baseAmount: '1',
            feeCurrency: 'RUNE',
            feeAmount: '0.02',
            from: 'thor1-user-wallet-11111',
            to: 'thorchain',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.bond',
            description: '1/1 - Bond 1 RUNE to thor1-node-address; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });
});
