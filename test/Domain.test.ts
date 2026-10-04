import {describe, expect, test} from "@jest/globals";
import {formatAmount, parseAmount} from "../src/domain/Amount";
import {toAsset} from "../src/domain/Asset";
import {baseToAssetAmountString} from "../src/utils/Amount";

describe('Amount', () => {
    test('formats as the CSV does today', () => {
        const bases = ['0', '1', '7', '10', '2000000', '100000000', '123456789', '500000000000', '140002825',
            '1840585015190', '99999999', '100000001', '-2000000', '-1'];

        for (const decimals of [4, 6, 8, 10, 18]) {
            for (const base of bases) {
                expect(formatAmount(parseAmount(base, decimals))).toBe(baseToAssetAmountString(base, decimals));
            }
        }
    });

    test('formats a base amount too large for a float exactly', () => {
        expect(formatAmount(parseAmount('123456789012345678901234567', 18))).toBe('123456789.012345678901234567');
    });

    test('rejects what is not a base-unit integer', () => {
        expect(() => parseAmount('', 8)).toThrow('Invalid base amount: ');
        expect(() => parseAmount('1.5', 8)).toThrow('Invalid base amount: 1.5');
    });
});

describe('Asset', () => {
    test.each([
        ['BTC.BTC', 'native'],
        ['THOR.RUNE', 'native'],
        ['THOR.TCY', 'native'],
        ['MAYA.CACAO', 'native'],
        ['x/ruji', 'native'],
        ['ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'token'],
        ['BTC/BTC', 'synth'],
        ['BTC~BTC', 'trade'],
        ['BTC-BTC', 'secured'],
        ['ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'secured'],
    ])('%s is %s', (notation, kind) => {
        expect(toAsset(notation)).toStrictEqual({notation, kind});
    });

    test('names the notation it could not parse', () => {
        expect(() => toAsset('INVALID')).toThrow('Failed to parse asset string: "INVALID"');
    });
});
