import {RunePoolDepositMapper} from '../src/cryptotax-thorchain/RunePoolDepositMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('RunePoolDepositMapper', () => {
    let runePoolDepositMapper: RunePoolDepositMapper;

    test('should correctly map a runePoolDeposit action', () => {
        const action = fs.readJSONSync('test/testdata/RunePoolDeposit.json');

        runePoolDepositMapper = new RunePoolDepositMapper();
        const result = runePoolDepositMapper.toCryptoTax(action, false, []);

        expect(result).toHaveLength(2);
        expect(result[0]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:00.000Z',
            type: CryptoTaxTransactionType.AddLiquidity,
            baseCurrency: 'RUNE',
            baseAmount: '200',
            from: 'thor1-user-wallet-11111',
            to: 'thorchain',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.add-liquidity',
            description: '1/2 - Deposit 200 RUNE to RUNEPool; 0000000000000000000000000000000000000000000000000000000000000000',
        });

        expect(result[1]).toStrictEqual({
            walletExchange: 'thor1-user-wallet-11111',
            timestamp: '2020-12-31T13:00:10.000Z',
            type: CryptoTaxTransactionType.ReceiveLpToken,
            baseCurrency: 'ThorLP.THOR.RUNE',
            baseAmount: '190',
            from: 'thorchain',
            to: 'thor1-user-wallet-11111',
            blockchain: 'THORChain',
            id: '2020-12-31T13:00:00.000Z.receive-lp-token',
            description: '2/2 - Receive LP token from RUNEPool; 0000000000000000000000000000000000000000000000000000000000000000',
        });
    });
});
