import {describe, expect, test} from '@jest/globals';
import {assignRowIds, csvField, renderCsv, rowId} from '../src/export/summ/csv';

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
        const [, line] = renderCsv([{...row('2020-12-31T13:00:00.000Z', 'kept, sent, returned'), id: 'T.refund-fee'}]).split('\n');
        expect(line).toBe('2020-12-31T13:00:00.000Z,fee,RUNE,1,,,,,,,,T.refund-fee,"kept, sent, returned",,');
    });

    test('rows newest first, without changing the order of the rows passed in', () => {
        const rows = [row('2021-01-01T00:00:00.000Z', 'old'), row('2021-01-02T00:00:00.000Z', 'new')];
        const lines = renderCsv(rows).split('\n');
        expect(lines[0]).toMatch(/^Timestamp \(UTC\),Type,/);
        expect(lines[1]).toContain(',new,');
        expect(rows.map(r => r.description)).toEqual(['old', 'new']);
    });
});

describe('row IDs', () => {
    const time = new Date('2021-01-01T00:00:00.000Z');
    const trace = {record: 'midgard/swap.ABC', role: 'trade-out', asset: 'BTC.BTC'};

    test('<action time>.<role>.<12 hex of the identity>, the same on every call', () => {
        expect(rowId(time, 'thor1a', trace)).toMatch(/^2021-01-01T00:00:00\.000Z\.trade-out\.[0-9a-f]{12}$/);
        expect(rowId(time, 'thor1a', trace)).toBe(rowId(time, 'thor1a', {...trace}));
    });

    test('differs by record, wallet, role and asset', () => {
        const ids = [
            rowId(time, 'thor1a', trace),
            rowId(time, 'thor1a', {...trace, record: 'midgard/swap.ABD'}),
            rowId(time, 'thor1b', trace),
            rowId(time, 'thor1a', {...trace, role: 'trade-in'}),
            rowId(time, 'thor1a', {...trace, asset: 'ETH.ETH'}),
        ];
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('two rows with one ID, or a row without one, is an error', () => {
        const a = {...row('2021-01-01T00:00:00.000Z'), id: 'X', trace};

        expect(assignRowIds([a, {...a, id: 'Y'}])).toHaveLength(2);
        expect(() => assignRowIds([a, {...a}])).toThrow('Two rows with the ID X (midgard/swap.ABC, trade-out)');
        expect(() => assignRowIds([row('2021-01-01T00:00:00.000Z')])).toThrow('Row without an ID');
    });
});
