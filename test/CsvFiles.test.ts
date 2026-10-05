import {describe, expect, test} from '@jest/globals';
import {csvFiles, isInRange} from '../src/export/summ/files';

const wallets = [{name: 'Main', address: 'thor1-user-wallet-11111', blockchain: 'THOR'}];
const row = (time: string, walletExchange = 'thor1-user-wallet-11111', fromTo: object = {}) =>
    ({timestamp: new Date(time), type: 'receive', baseCurrency: 'RUNE', baseAmount: '1', walletExchange, ...fromTo} as any);
const july = {from: '2025-07-01', to: '2025-07-31'};
const names = (files: {name: string; rows: any[]}[]) => files.map(file => `${file.name} (${file.rows.length})`);

describe('CSV file layout', () => {
    test('a period includes the whole of its last day', () => {
        expect(isInRange(new Date('2025-07-01T00:00:00.000Z'), july)).toBe(true);
        expect(isInRange(new Date('2025-07-31T23:59:59.999Z'), july)).toBe(true);
        expect(isInRange(new Date('2025-06-30T23:59:59.999Z'), july)).toBe(false);
        expect(isInRange(new Date('2025-08-01T00:00:00.000Z'), july)).toBe(false);
    });

    test('a row late on a month-end day is in that month\'s files', () => {
        const rows = [row('2025-07-31T18:00:00.000Z'), row('2025-08-01T01:00:00.000Z')];
        const {files, exported} = csvFiles(rows, [july, {from: '2025-08-01', to: '2025-08-31'}], wallets);
        expect(names(files)).toEqual([
            'all.csv (2)',
            'all-2025-07-01_2025-07-31.csv (1)',
            '2025-07-01_2025-07-31_THOR_11111_Main.csv (1)',
            'all-2025-08-01_2025-08-31.csv (1)',
            '2025-08-01_2025-08-31_THOR_11111_Main.csv (1)',
        ]);
        expect(exported).toBe(2);
    });

    test('rows outside every period are only in all.csv', () => {
        const {files, exported} = csvFiles([row('2024-01-01T00:00:00.000Z')], [july], wallets);
        expect(names(files)).toEqual(['all.csv (1)', 'all-2025-07-01_2025-07-31.csv (0)']);
        expect(exported).toBe(0);
    });

    test('thorchain rows go to the swaps file; an unknown wallet is named by its address, with a warning', () => {
        const rows = [row('2025-07-02T00:00:00.000Z', 'thorchain', {from: 'thorchain'}), row('2025-07-03T00:00:00.000Z', 'thor1-other')];
        const {files, warnings} = csvFiles(rows, [july], wallets);
        expect(names(files).slice(2)).toEqual(['2025-07-01_2025-07-31_THOR_thorchain_swaps.csv (1)', '2025-07-01_2025-07-31_thor1-other.csv (1)']);
        expect(warnings).toEqual(['wallet not found in config: thor1-other']);
    });

    test('a thorchain row neither from nor to thorchain is an error', () => {
        expect(() => csvFiles([row('2025-07-02T00:00:00.000Z', 'thorchain')], [july], wallets)).toThrow('bad txs');
    });

    test('a row in a period with no wallet is an error', () => {
        expect(() => csvFiles([row('2025-07-02T00:00:00.000Z', '')], [july], wallets)).toThrow('failed to export all txs');
    });
});
