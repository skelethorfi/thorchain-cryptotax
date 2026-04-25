import {RunePoolWithdrawMapper} from '../src/cryptotax-thorchain/RunePoolWithdrawMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('RunePoolWithdrawMapper', () => {
    let runePoolWithdrawMapper: RunePoolWithdrawMapper;

    test('should correctly map a runePoolWithdraw action', () => {
        const action = fs.readJSONSync('test/testdata/RunePoolWithdraw.json');

        runePoolWithdrawMapper = new RunePoolWithdrawMapper();
        const result = runePoolWithdrawMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(2);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.ReturnLpToken,
            baseCurrency: 'ThorLP.THOR.RUNE',
            baseAmount: '190',
            from: 'thor1-user-wallet-11111',
            to: 'thorchain',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.return-lp-token',
            description: '1/2 - Return LP token to RUNEPool; 0000000000000000000000000000000000000000000000000000000000000000',
        });

        expect(result[1]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:10.000Z',
            type: CryptoTaxTransactionType.RemoveLiquidity,
            baseCurrency: 'RUNE',
            baseAmount: '220',
            from: 'thorchain',
            to: 'thor1-user-wallet-11111',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.remove-liquidity',
            description: '2/2 - Withdraw 220 RUNE from RUNEPool; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });
});
