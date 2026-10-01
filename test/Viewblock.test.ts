import {describe, expect, jest, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {Viewblock} from '../src/viewblock';

describe('Viewblock', () => {
    test('caches an empty result so offline runs can replay it', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-viewblock-'));
        const viewblock = new Viewblock(dir);
        jest.spyOn(viewblock, 'getTxs').mockResolvedValue({docs: [], pages: 0, total: 0});
        jest.spyOn(console, 'log').mockImplementation(() => {});

        const txs = await viewblock.getAllTxs({address: 'thor1-empty-wallet', network: 'mainnet'});

        expect(txs).toEqual([]);
        expect(new Viewblock(dir, {offline: true}).cache.read('thor1-empty-wallet')).toEqual([]);
    });
});
