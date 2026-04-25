import {RujiraMergeDepositMapper} from '../src/cryptotax-thorchain/RujiraMergeDepositMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('RujiraMergeDepositMapper', () => {
    let rujiraMergeDepositMapper: RujiraMergeDepositMapper;

    test('should correctly map a rujira merge deposit action', () => {
        const action = fs.readJSONSync('test/testdata/RujiraMergeDeposit.json');

        rujiraMergeDepositMapper = new RujiraMergeDepositMapper();
        const result = rujiraMergeDepositMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.StakingDeposit,
            baseCurrency: 'THOR.KUJI',
            baseAmount: '100',
            from: 'thor1-user-wallet-11111',
            to: 'thorchain',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.rujira-merge-deposit',
            description: '1/1 - wasm-rujira-merge/deposit 100 THOR.KUJI; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });
});
