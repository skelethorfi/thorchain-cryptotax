import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {baseToAssetAmountString} from "../src/utils/Amount.ts";

describe('Amount', () => {
    test('baseToAssetAmountString handles small amounts without scientific notation', () => {
        const result = baseToAssetAmountString("1");
        assert.equal(result, "0.00000001");
    });

    test('baseToAssetAmountString handles large amounts without commas', () => {
        const result = baseToAssetAmountString("12345678900000000");
        assert.equal(result, "123456789");
    });

    test('baseToAssetAmountString handles zero amount', () => {
        const result = baseToAssetAmountString("0");
        assert.equal(result, "0");
    });

    test('baseToAssetAmountString handles different decimals', () => {
        const result = baseToAssetAmountString("1000000000000000000", 18);
        assert.equal(result, "1");
    });

    test('baseToAssetAmountString handles amounts with decimal output', () => {
        const result = baseToAssetAmountString("50000000", 8);
        assert.equal(result, "0.5");
    });

    test('baseToAssetAmountString handles very large amounts', () => {
        const result = baseToAssetAmountString("1000000000000000000000", 8);
        assert.equal(result, "10000000000000");
    });

    test('baseToAssetAmountString handles zero decimals', () => {
        const result = baseToAssetAmountString("123", 0);
        assert.equal(result, "123");
    });

    test('baseToAssetAmountString trims trailing zeros', () => {
        const result = baseToAssetAmountString("100000000", 8);
        assert.equal(result, "1");
    });

    // Error-throwing tests
    test('baseToAssetAmountString throws error for empty string', () => {
        assert.throws(() => baseToAssetAmountString(""), /Invalid base amount: /);
    });

    test('baseToAssetAmountString throws error for non-numeric string', () => {
        assert.throws(() => baseToAssetAmountString("abc"), /Invalid base amount: abc/);
    });

    test('baseToAssetAmountString throws error for string with invalid characters', () => {
        assert.throws(() => baseToAssetAmountString("123abc"), /Invalid base amount: 123abc/);
    });

    test('baseToAssetAmountString handles negative amounts', () => {
        const result = baseToAssetAmountString("-1");
        assert.equal(result, "-0.00000001");
    });
});
