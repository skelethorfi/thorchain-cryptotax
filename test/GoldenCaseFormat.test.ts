import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {formatRows, parseRows} from '../src/fixtures/GoldenCase.ts';

const row = (type: string, baseAmount: string) => ({timestamp: '2020-12-31T13:00:00.000Z', type, baseAmount} as any);

describe('expected.yaml format', () => {
    test('one document per row, separated by ---', () => {
        const text = formatRows([row('send', '1'), row('receive', '0.02')]);

        assert.equal(text.split('\n').filter(line => line === '---').length, 1);
        assert.deepEqual(parseRows(text), [row('send', '1'), row('receive', '0.02')]);
    });

    test('number-like strings and timestamps stay strings', () => {
        assert.ok(formatRows([row('send', '0.02')]).includes('baseAmount: "0.02"'));
        assert.deepEqual(parseRows(formatRows([row('send', '0.02')]))[0], row('send', '0.02'));
    });

    test('no rows is written as []', () => {
        assert.equal(formatRows([]), '[]\n');
        assert.deepEqual(parseRows('[]\n'), []);
    });

    test('an unquoted amount parses as a number, so the golden test fails', () => {
        assert.equal(parseRows('type: send\nbaseAmount: 0.02\n')[0].baseAmount, 0.02);
    });
});
