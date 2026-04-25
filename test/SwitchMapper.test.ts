import {SwitchMapper} from '../src/cryptotax-thorchain/SwitchMapper';
import {describe, expect, test} from '@jest/globals';
import {CryptoTaxTransactionType} from '../src/cryptotax';
import fs from 'fs-extra';

describe('SwitchMapper', () => {
    let switchMapper: SwitchMapper;

    test('should correctly map a switch from GAIA.KUJI to THOR.KUJI', () => {
        const action = fs.readJSONSync('test/testdata/Switch_KUJI.json');

        const thornodeTxs = {
            "tx": {
                "id": "0000000000000000000000000000000000000000000000000000000000000000",
                "chain": "GAIA",
                "from_address": "cosmos1-user-wallet-11111",
                "to_address": "cosmos1-thorchain-wallet",
                "coins": [
                    {
                        "asset": "GAIA.KUJI",
                        "amount": "100000000",
                        "decimals": 6
                    }
                ],
                "gas": [
                    {
                        "asset": "GAIA.ATOM",
                        "amount": "69600",
                        "decimals": 6
                    }
                ],
                "memo": "switch:thor1-user-wallet-11111"
            }
        };

        switchMapper = new SwitchMapper();
        const result = switchMapper.toCryptoTax(action, false, [thornodeTxs as any]);

        expect(result).toHaveLength(2);
        expect(result[0].type).toBe(CryptoTaxTransactionType.BridgeOut);
        expect(result[1].type).toBe(CryptoTaxTransactionType.BridgeIn);

        expect(result[0].description).toBe('1/2 - Switch GAIA.KUJI to THOR.KUJI (send GAIA.KUJI); 0000000000000000000000000000000000000000000000000000000000000000');
        expect(result[0].baseCurrency).toBe('KUJI');
        expect(result[0].baseAmount).toBe('1');
        expect(result[0].feeCurrency).toBe('ATOM');
        expect(result[0].feeAmount).toBe('0.000696');
        expect(result[0].from).toBe('cosmos1-user-wallet-11111');
        expect(result[0].to).toBe('thor1-user-wallet-11111');
        expect(result[0].blockchain).toBe('GAIA');

        expect(result[1].description).toBe('2/2 - Switch GAIA.KUJI to THOR.KUJI (receive THOR.KUJI); 0000000000000000000000000000000000000000000000000000000000000000');
        expect(result[1].baseCurrency).toBe('KUJI');
        expect(result[1].baseAmount).toBe('1');
        expect(result[1].from).toBe('cosmos1-user-wallet-11111');
        expect(result[1].to).toBe('thor1-user-wallet-11111');
        expect(result[1].blockchain).toBe('THORChain');
    });
});
