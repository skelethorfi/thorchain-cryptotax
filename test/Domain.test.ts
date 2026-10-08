import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {formatAmount, parseAmount} from "../src/domain/Amount.ts";
import {toAsset} from "../src/domain/Asset.ts";
import {baseToAssetAmountString} from "../src/utils/Amount.ts";

describe('Amount', () => {
    test('formats as the CSV does today', () => {
        const bases = ['0', '1', '7', '10', '2000000', '100000000', '123456789', '500000000000', '140002825',
            '1840585015190', '99999999', '100000001', '-2000000', '-1'];

        for (const decimals of [4, 6, 8, 10, 18]) {
            for (const base of bases) {
                assert.equal(formatAmount(parseAmount(base, decimals)), baseToAssetAmountString(base, decimals));
            }
        }
    });

    test('formats a base amount too large for a float exactly', () => {
        assert.equal(formatAmount(parseAmount('123456789012345678901234567', 18)), '123456789.012345678901234567');
    });

    test('rejects what is not a base-unit integer', () => {
        assert.throws(() => parseAmount('', 8), /Invalid base amount: /);
        assert.throws(() => parseAmount('1.5', 8), /Invalid base amount: 1\.5/);
    });
});

describe('Asset', () => {
    for (const [notation, kind] of [
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
    ]) {
        test(`${notation} is ${kind}`, () => {
            assert.deepEqual(toAsset(notation), {notation, kind});
        });
    }

    test('names the notation it could not parse', () => {
        assert.throws(() => toAsset('INVALID'), /Failed to parse asset string: "INVALID"/);
    });
});
