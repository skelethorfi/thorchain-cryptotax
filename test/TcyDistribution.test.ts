import {runBundle} from '../src/pipeline/run';
import {THORCHAIN} from '../src/protocols/Protocol';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';

describe("TcyDistribution", () => {
    test("should map tcy distribution", () => {
        const data = require("./testdata/TcyDistribution.json");

        const bundle = {source: 'tcy' as const, protocol: 'thorchain' as const, wallet: 'thor1-user-wallet-11111', data, thornodeTxs: [], cosmosTxs: []};
        const result = runBundle(bundle, THORCHAIN).rows;

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: new Date('2020-12-31T13:00:00.000Z'),
            type: CryptoTaxTransactionType.Staking,
            baseCurrency: 'RUNE',
            baseAmount: '1.23456',
            from: 'thorchain',
            to: 'thor1-user-wallet-11111',
            blockchain: 'THORChain',
            description: '1/1 - Received 1.23456 RUNE from TCY staking',
            id: '2020-12-31T13:00:00.000Z.staking',
            referencePricePerUnit: '1.23456789',
            referencePriceCurrency: 'USD',
        });
    });
});
