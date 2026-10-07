import {afterEach, describe, expect, jest, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {Viewblock} from '../src/sources/viewblock';
import {withoutCurrentValues} from '../src/sources/store/Sources';
import {RecordStore} from '../src/sources/store/RecordStore';
import {http} from '../src/sources/http';

describe('Viewblock', () => {
    const tx = (hash: string) => ({hash, timestamp: Date.UTC(2021, 6, 1)});
    const pages = (...docs: object[][]) => {
        const total = docs.flat().length;
        return jest.spyOn(http, 'get').mockImplementation(async (url: string) =>
            ({data: {docs: docs[Number(new URL(url).searchParams.get('page')) - 1] ?? [], pages: docs.length, total}}) as any);
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('reads every page, with viewblock.io as the Origin', async () => {
        const get = pages([tx('A'), tx('B')], [tx('C')]);
        const store = new RecordStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-viewblock-')));

        const txs = await new Viewblock(store).getTxs('thor1-wallet');

        expect(txs.map(t => t.hash)).toEqual(['A', 'B', 'C']);
        expect(get.mock.calls.map(([url]) => new URL(url as string).searchParams.get('page'))).toEqual(['1', '2']);
        expect(get.mock.calls[0][1]).toEqual({headers: {Origin: 'https://viewblock.io'}});
    });

    test('stores an empty result so offline runs can replay it', async () => {
        pages([]);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-viewblock-'));

        expect(await new Viewblock(new RecordStore(dir)).getTxs('thor1-empty-wallet')).toEqual([]);
        expect(await new Viewblock(new RecordStore(dir, {offline: true})).getTxs('thor1-empty-wallet')).toEqual([]);
    });

    test('refuses a listing shorter than the total it reports', async () => {
        jest.spyOn(http, 'get').mockResolvedValue({data: {docs: [tx('A')], pages: 1, total: 2}} as any);
        const store = new RecordStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-viewblock-')));

        await expect(new Viewblock(store).getTxs('thor1-wallet')).rejects.toThrow('Viewblock listed 1 txs but reports 2');
    });
});

describe('withoutCurrentValues', () => {
    test("drops Viewblock's value at today's price and keeps the value at the time of the tx", () => {
        const tx = {input: {amount: '1', usd: '10', usdNew: '12'}, outbounds: [{usd: '5', usdNew: '6'}]};

        expect(withoutCurrentValues([tx])).toEqual([{input: {amount: '1', usd: '10'}, outbounds: [{usd: '5'}]}]);
    });
});
