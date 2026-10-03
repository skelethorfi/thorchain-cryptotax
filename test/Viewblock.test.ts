import {describe, expect, jest, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {Viewblock, withoutCurrentValues} from '../src/viewblock';
import {RecordStore} from '../src/cache/RecordStore';

describe('Viewblock', () => {
    test('caches an empty result so offline runs can replay it', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-viewblock-'));
        const viewblock = new Viewblock(new RecordStore(dir));
        jest.spyOn(viewblock, 'getTxs').mockResolvedValue({docs: [], pages: 0, total: 0});
        jest.spyOn(console, 'log').mockImplementation(() => {});

        const txs = await viewblock.getAllTxs({address: 'thor1-empty-wallet', network: 'mainnet'});

        expect(txs).toEqual([]);
        expect(await new Viewblock(new RecordStore(dir, {offline: true})).getAllTxs({address: 'thor1-empty-wallet', network: 'mainnet'})).toEqual([]);
    });
});

describe('withoutCurrentValues', () => {
    test("drops Viewblock's value at today's price and keeps the value at the time of the tx", () => {
        const tx = {input: {amount: '1', usd: '10', usdNew: '12'}, outbounds: [{usd: '5', usdNew: '6'}]};

        expect(withoutCurrentValues([tx])).toEqual([{input: {amount: '1', usd: '10'}, outbounds: [{usd: '5'}]}]);
    });
});
