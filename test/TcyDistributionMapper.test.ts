import {TcyDistributionMapper} from "../src/cryptotax-thorchain/TcyDistributionMapper";
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';

describe("TcyDistributionMapper", () => {
    test("should map tcy distribution", () => {
        const data = require("./testdata/TcyDistribution.json");

        const mapper = new TcyDistributionMapper(data, "thor1-user-wallet-11111");

        const result = mapper.toCtc();

        expect(result).toHaveLength(1);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
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
