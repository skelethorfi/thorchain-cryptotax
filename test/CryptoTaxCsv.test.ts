import {describe, expect, test} from '@jest/globals';
import {csvField, renderCsv} from '../src/export/summ/csv';

const row = (time: string, description = '') => ({timestamp: new Date(time), type: 'fee', baseCurrency: 'RUNE', baseAmount: '1', description} as any);

describe('CSV rendering', () => {
    test('writes plain fields as they are', () => {
        expect(csvField('refund (ABC): 0.5 RUNE kept')).toBe('refund (ABC): 0.5 RUNE kept');
        expect(csvField('')).toBe('');
    });

    test('quotes a field with a comma or a double quote, doubling the quotes', () => {
        expect(csvField('kept by thorchain, 1 BTC sent')).toBe('"kept by thorchain, 1 BTC sent"');
        expect(csvField('a "b"')).toBe('"a ""b"""');
    });

    test('keeps every row on one line', () => {
        expect(csvField('one\ntwo')).toBe('one; two');
    });

    test('a description with commas stays in its column', () => {
        const [, line] = renderCsv([row('2020-12-31T13:00:00.000Z', 'kept, sent, returned')], 'f.csv').split('\n');
        expect(line).toBe('2020-12-31T13:00:00.000Z,fee,RUNE,1,,,,,,,,f.csv:1,"kept, sent, returned",,');
    });

    test('rows newest first, numbered from the oldest, without changing the rows passed in', () => {
        const rows = [row('2021-01-01T00:00:00.000Z', 'old'), row('2021-01-02T00:00:00.000Z', 'new')];
        const lines = renderCsv(rows, 'f.csv').split('\n');
        expect(lines[0]).toMatch(/^Timestamp \(UTC\),Type,/);
        expect(lines.slice(1).map(line => line.split(',')[11])).toEqual(['f.csv:2', 'f.csv:1']);
        expect(lines[1]).toContain(',new,');
        expect(rows.map(r => r.id)).toEqual([undefined, undefined]);
    });
});
