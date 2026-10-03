import {describe, expect, jest, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {RecordStore} from '../src/cache/RecordStore';
import {importCache} from '../src/cache/cli';
import {MidgardService} from '../src/cryptotax-thorchain/MidgardService';
import {ThornodeService} from '../src/cryptotax-thorchain/ThornodeService';

const action = (txID: string, extra: any = {}) => ({type: 'addLiquidity', status: 'success', date: '1', height: '1', in: [{txID, address: 'w', coins: []}], out: [], pools: [], metadata: {}, ...extra});

describe('store import', () => {
    test('keeps every version from old caches; runs use the good copy; genesisTx placeholders are left out', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-import-'));
        const fy25 = path.join(dir, 'FY2025', 'cache');
        const history = path.join(dir, 'history', 'cache');

        // FY2025 (older Midgard): a genesis placeholder and a full THORNode tx
        fs.outputJsonSync(path.join(fy25, 'midgard', 'w.json'), [action('genesisTx'), action('A')]);
        fs.outputJsonSync(path.join(fy25, 'thornode', 'A.json'), {tx: {gas: [{asset: 'BTC.BTC', amount: '1'}]}});
        // A year later: the real old add from the archive, and THORNode has pruned the tx
        fs.outputJsonSync(path.join(history, 'midgard', 'w.json'), [action('A'), action('OLD')]);
        fs.outputJsonSync(path.join(history, 'thornode', 'A.json'), {});

        const store = new RecordStore(path.join(dir, 'store'));
        const fy25Counts = importCache(store, fy25);
        importCache(store, history);

        expect(fy25Counts.midgard.skipped).toBe(1);
        expect(store.copies('thornode', 'A').map(copy => copy.importedFrom)).toEqual(['FY2025/cache/thornode/A.json', 'history/cache/thornode/A.json']);

        const offline = new RecordStore(path.join(dir, 'store'), {offline: true});
        jest.spyOn(console, 'log').mockImplementation(() => {});
        expect((await new MidgardService(offline).getActions('w')).map(a => a.in[0].txID)).toEqual(['A', 'OLD']);
        expect(await new ThornodeService(offline).getTxStatus('A')).toEqual({tx: {gas: [{asset: 'BTC.BTC', amount: '1'}]}});
    });

    test('importing the same cache again adds nothing', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-import-'));
        fs.outputJsonSync(path.join(dir, 'cache', 'thornode', 'A.json'), {tx: {}});
        const store = new RecordStore(path.join(dir, 'store'));

        importCache(store, path.join(dir, 'cache'));
        const again = importCache(store, path.join(dir, 'cache'));

        expect(again.thornode).toEqual({copies: 0, existing: 1, lists: 0, skipped: 0});
    });
});

describe('TCY records', () => {
    test("two wallets paid on the same day keep their own distributions", async () => {
        const {TcyDistributionService} = await import('../src/cryptotax-thorchain/TcyDistributionService');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-tcy-'));
        fs.outputJsonSync(path.join(dir, 'cache', 'tcy', 'tcy_distribution_w1.json'), {distributions: [{date: '1', amount: '10', price: '1'}]});
        fs.outputJsonSync(path.join(dir, 'cache', 'tcy', 'tcy_distribution_w2.json'), {distributions: [{date: '1', amount: '99', price: '1'}]});
        importCache(new RecordStore(path.join(dir, 'store')), path.join(dir, 'cache'));

        const tcy = new TcyDistributionService(new RecordStore(path.join(dir, 'store'), {offline: true}));
        expect((await tcy.getTcyDistribution('w1')).distributions).toEqual([{date: '1', amount: '10', price: '1'}]);
        expect((await tcy.getTcyDistribution('w2')).distributions).toEqual([{date: '1', amount: '99', price: '1'}]);
    });
});
