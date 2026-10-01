import {describe, expect, test} from '@jest/globals';
import {formatRows, parseRows} from '../src/fixtures/GoldenCase';

const row = (type: string, baseAmount: string) => ({timestamp: '2020-12-31T13:00:00.000Z', type, baseAmount} as any);

describe('expected.yaml format', () => {
    test('one document per row, separated by ---', () => {
        const text = formatRows([row('send', '1'), row('receive', '0.02')]);

        expect(text.split('\n').filter(line => line === '---')).toHaveLength(1);
        expect(parseRows(text)).toEqual([row('send', '1'), row('receive', '0.02')]);
    });

    test('number-like strings and timestamps stay strings', () => {
        expect(formatRows([row('send', '0.02')])).toContain('baseAmount: "0.02"');
        expect(parseRows(formatRows([row('send', '0.02')]))[0]).toStrictEqual(row('send', '0.02'));
    });

    test('no rows is written as []', () => {
        expect(formatRows([])).toBe('[]\n');
        expect(parseRows('[]\n')).toEqual([]);
    });

    test('an unquoted amount parses as a number, so the golden test fails', () => {
        expect(parseRows('type: send\nbaseAmount: 0.02\n')[0].baseAmount).toBe(0.02);
    });
});
