import {TcyClaimMapper} from '../src/cryptotax-thorchain/TcyClaimMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('TcyClaimMapper', () => {
    let tcyClaimMapper: TcyClaimMapper;

    test('should correctly map a tcy_claim action', () => {
        const action = fs.readJSONSync('test/testdata/TcyClaim.json');

        tcyClaimMapper = new TcyClaimMapper();
        const result = tcyClaimMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.Receive,
            baseCurrency: 'TCY',
            baseAmount: '9999.5555',
            from: 'thorchain',
            to: 'thor1-user-wallet-11111',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.tcy_claim',
            description: '1/1 - Claim 9999.5555 TCY for address bc1-user-wallet-11111; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });
});
