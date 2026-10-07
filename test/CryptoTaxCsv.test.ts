import {describe, expect, test} from '@jest/globals';
import {assignRowIds, csvField, renderCsv} from '../src/export/summ/csv';

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
    test("keep the mapper's ID, so a row's ID does not depend on the rows around it", () => {
        const a = {...row('2021-01-01T00:00:00.000Z', 'a'), id: '2021-01-01T00:00:00.000Z.send'};
        const b = {...row('2021-01-02T00:00:00.000Z', 'b'), id: '2021-01-02T00:00:00.000Z.send'};
        const earlier = {...row('2020-06-01T00:00:00.000Z', 'earlier'), id: '2020-06-01T00:00:00.000Z.send'};

        expect(assignRowIds([a, b]).map(r => r.id)).toEqual(assignRowIds([earlier, a, b]).slice(1).map(r => r.id));
    });

    test('a second row with the same ID gets .2, by content, whatever the order the rows come in', () => {
        const x = {...row('2021-01-01T00:00:00.000Z', 'swap from wallet 1'), id: 'T.bridge-trade-out'};
        const y = {...row('2021-01-01T00:00:00.000Z', 'swap from wallet 2'), id: 'T.bridge-trade-out'};
        const ids = (rows: any[]) => Object.fromEntries(assignRowIds(rows).map(r => [r.description, r.id]));

        expect(ids([x, y])).toEqual({'swap from wallet 1': 'T.bridge-trade-out', 'swap from wallet 2': 'T.bridge-trade-out.2'});
        expect(ids([y, x])).toEqual(ids([x, y]));
        expect(x.id).toBe('T.bridge-trade-out');
    });

    test('a row without one is given its time and type', () => {
        expect(assignRowIds([row('2021-01-01T00:00:00.000Z')])[0].id).toBe('2021-01-01T00:00:00.000Z.fee');
    });
});
