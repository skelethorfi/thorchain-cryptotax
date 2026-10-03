import {describe, expect, jest, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {chooseCopy, Copy, RecordRules, RecordStore, sha256, StoreMissError} from '../src/cache/RecordStore';
import {SnapshotManifest} from '../src/cache/SnapshotManifest';
import {THORNODE_RULES} from '../src/cache/Sources';

const makeDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-store-'));
const fetching = <T>(data: T) => jest.fn(async () => ({data, url: 'https://source/x'}));

interface Tx {
    id: string;
    status?: string;
    gas?: string;
}

const RULES: RecordRules<Tx> = {
    isPending: tx => tx.status === 'pending',
    completeness: tx => tx.gas ? 1 : 0,
};
const LIST = {keyOf: (tx: Tx) => tx.id, rules: RULES};

describe('RecordStore records', () => {
    test('fetches a record once and stores it with its URL and hash', async () => {
        const root = makeDir();
        const fetch = fetching({id: 'a', gas: '1'});

        expect(await new RecordStore(root).record('thornode', 'a', fetch)).toEqual({id: 'a', gas: '1'});
        expect(await new RecordStore(root).record('thornode', 'a', fetch)).toEqual({id: 'a', gas: '1'});
        expect(fetch).toHaveBeenCalledTimes(1);

        const [copy] = new RecordStore(root).copies('thornode', 'a');
        expect(copy).toEqual(expect.objectContaining({fetchedAt: expect.any(String), url: 'https://source/x', sha256: sha256({id: 'a', gas: '1'})}));
    });

    test('offline, a record not stored is an error', async () => {
        await expect(new RecordStore(makeDir(), {offline: true}).record('thornode', 'a', fetching({id: 'a'})))
            .rejects.toThrow(StoreMissError);
    });

    test('refetching stores a changed copy next to the old one; an unchanged one adds nothing', async () => {
        const root = makeDir();
        await new RecordStore(root).record('thornode', 'a', fetching({id: 'a', gas: '1'}));
        await new RecordStore(root, {fetch: 'all'}).record('thornode', 'a', fetching({id: 'a', gas: '1'}));
        expect(new RecordStore(root).copies('thornode', 'a')).toHaveLength(1);

        const used = await new RecordStore(root, {fetch: 'all'}).record('thornode', 'a', fetching({id: 'a', gas: '2'}), RULES);
        expect(used).toEqual({id: 'a', gas: '2'});
        expect(new RecordStore(root).copies('thornode', 'a')).toHaveLength(2);
    });

    test('a pruned copy is stored, but the earlier good copy is used', async () => {
        const root = makeDir();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        await new RecordStore(root).record('thornode', 'a', fetching({id: 'a', gas: '1'}), RULES);

        const used = await new RecordStore(root, {fetch: 'all'}).record('thornode', 'a', fetching({id: 'a'}), RULES);

        expect(used).toEqual({id: 'a', gas: '1'});
        expect(new RecordStore(root).copies('thornode', 'a')).toHaveLength(2);
    });

    test('a finalised copy is used over the pending one, which is kept', async () => {
        const root = makeDir();
        await new RecordStore(root).record('thornode', 'a', fetching({id: 'a', status: 'pending'}), RULES);

        const used = await new RecordStore(root, {}).record('thornode', 'a', fetching({id: 'a', status: 'done'}), RULES);

        expect(used).toEqual({id: 'a', status: 'done'});
        expect(new RecordStore(root).copies<Tx>('thornode', 'a').map(c => c.data.status)).toEqual(['pending', 'done']);
    });
});

describe('fetch modes', () => {
    test('by default a pending record is fetched again and a finalised one is not; --refetch-all fetches both', async () => {
        const root = makeDir();
        await new RecordStore(root).record('thornode', 'pending', fetching<Tx>({id: 'pending', status: 'pending'}), RULES);
        await new RecordStore(root).record('thornode', 'final', fetching<Tx>({id: 'final', gas: '1'}), RULES);

        const pending = fetching<Tx>({id: 'pending', status: 'done'});
        const final = fetching<Tx>({id: 'final', gas: '2'});
        expect(await new RecordStore(root).record('thornode', 'pending', pending, RULES)).toEqual({id: 'pending', status: 'done'});
        expect(await new RecordStore(root).record('thornode', 'final', final, RULES)).toEqual({id: 'final', gas: '1'});
        expect(final).not.toHaveBeenCalled();

        expect(await new RecordStore(root, {fetch: 'all'}).record('thornode', 'final', final, RULES)).toEqual({id: 'final', gas: '2'});
    });

    test('wallet lists are fetched again on every run, except offline', async () => {
        const root = makeDir();
        await new RecordStore(root).list('midgard', 'w', fetching([{id: 'a'}]), LIST);
        const again = fetching([{id: 'a'}, {id: 'b'}]);

        expect(await new RecordStore(root, {offline: true}).list('midgard', 'w', again, LIST)).toEqual([{id: 'a'}]);
        expect(again).not.toHaveBeenCalled();
        expect(await new RecordStore(root).list('midgard', 'w', again, LIST)).toEqual([{id: 'a'}, {id: 'b'}]);
    });

    test('offline, a pending record is not fetched again', async () => {
        const root = makeDir();
        await new RecordStore(root).record('thornode', 'p', fetching<Tx>({id: 'p', status: 'pending'}), RULES);
        const fetch = fetching<Tx>({id: 'p', status: 'done'});

        expect(await new RecordStore(root, {offline: true}).record('thornode', 'p', fetch, RULES)).toEqual({id: 'p', status: 'pending'});
        expect(fetch).not.toHaveBeenCalled();
    });
});

describe('chooseCopy', () => {
    const copy = (data: Tx, n: number): Copy<Tx> => ({file: `${n}`, n, fetchedAt: `${n}`, sha256: sha256(data), data});

    test('says why a copy is used', () => {
        expect(chooseCopy([copy({id: 'a'}, 1)], RULES).choice).toBe('only');
        expect(chooseCopy([copy({id: 'a', status: 'pending'}, 1), copy({id: 'a'}, 2)], RULES).choice).toBe('finalised');
        expect(chooseCopy([copy({id: 'a', gas: '1'}, 1), copy({id: 'a', gas: '2'}, 2)], RULES).choice).toBe('revised');

        const pruned = chooseCopy([copy({id: 'a', gas: '1'}, 1), copy({id: 'a'}, 2)], RULES);
        expect(pruned.choice).toBe('kept-over-pruned');
        expect(pruned.copy.data).toEqual({id: 'a', gas: '1'});
    });
});

describe('RecordStore lists', () => {
    test('stores each item as its own record, shared between wallets', async () => {
        const root = makeDir();
        const store = new RecordStore(root);

        await store.list('midgard', 'w1', fetching([{id: 'a'}, {id: 'b'}]), LIST);
        await store.list('midgard', 'w2', fetching([{id: 'b'}]), LIST);

        expect(fs.readdirSync(path.join(root, 'records', 'midgard')).sort()).toEqual(['a-000.json', 'b-000.json']);
        expect(store.copies('midgard', 'b')).toHaveLength(1);
    });

    test('fetching the latest: new items are added, finalised ones replace pending ones, and missing ones are kept', async () => {
        const root = makeDir();
        await new RecordStore(root).list('midgard', 'w', fetching([{id: 'old'}, {id: 'gone'}, {id: 'p', status: 'pending'}]), LIST);

        const manifest = new SnapshotManifest();
        const items = await new RecordStore(root, {manifest})
            .list('midgard', 'w', fetching([{id: 'new'}, {id: 'old'}, {id: 'p', status: 'success'}]), LIST);

        expect(items).toEqual([{id: 'new'}, {id: 'old'}, {id: 'p', status: 'success'}, {id: 'gone'}]);
        expect(manifest.findRecord('midgard', 'gone')?.missing).toBe(true);
        expect(manifest.findRecord('midgard', 'p')?.choice).toBe('finalised');
        expect(manifest.findRecord('midgard', 'new')?.fetched).toBe('new');
        expect(manifest.findRecord('midgard', 'old')?.fetched).toBe('unchanged');
        expect(manifest.findList('midgard', 'w')?.missing).toEqual(['gone']);
    });

    test('normalises before comparing, so a field that changes on every fetch adds no copy', async () => {
        const root = makeDir();
        const options = {keyOf: (tx: Tx & {now?: string}) => tx.id, rules: {normalise: ({now, ...tx}: Tx & {now?: string}) => tx}};
        await new RecordStore(root).list('viewblock', 'w', fetching([{id: 'a', now: '1'}]), options);
        await new RecordStore(root, {}).list('viewblock', 'w', fetching([{id: 'a', now: '2'}]), options);

        expect(new RecordStore(root).copies('viewblock', 'a').map(c => c.data)).toEqual([{id: 'a'}]);
    });

    test('an empty list is stored, so offline runs can replay it', async () => {
        const root = makeDir();
        await new RecordStore(root).list('viewblock', 'w', fetching([] as Tx[]), LIST);

        expect(await new RecordStore(root, {offline: true}).list('viewblock', 'w', fetching([{id: 'x'}]), LIST)).toEqual([]);
    });

});

describe('Layout', () => {
    const DATED = {keyOf: (tx: Tx & {month?: string}) => tx.id, rules: {folderOf: (tx: Tx & {month?: string}) => tx.month ?? ''}};

    test('a record is <key>-NNN.json in the folder its rules give; a later copy stays next to the first', async () => {
        const root = makeDir();
        await new RecordStore(root).list('midgard', 'w', fetching([{id: 'swap.ABC', month: '2025/07'}]), DATED);
        // A revision whose date moved to another month
        await new RecordStore(root).list('midgard', 'w', fetching([{id: 'swap.ABC', month: '2025/08'}]), DATED);

        expect(fs.readdirSync(path.join(root, 'records', 'midgard', '2025', '07')).sort()).toEqual(['swap.ABC-000.json', 'swap.ABC-001.json']);
        expect(fs.readdirSync(path.join(root, 'lists', 'midgard'))).toEqual(['w-000.json']);
        expect(fs.readJSONSync(path.join(root, 'records', 'midgard', '2025', '07', 'swap.ABC-000.json'))).toEqual(expect.objectContaining({source: 'midgard', key: 'swap.ABC'}));
    });

    test('names decode back to keys, and are safe as file names', async () => {
        const {encodeName, decodeName} = await import('../src/cache/RecordStore');
        const key = 'contract.CFB6.wasm-rujira-fin/trade';

        expect(encodeName(key)).toBe('contract.CFB6.wasm-rujira-fin%2Ftrade');
        expect(decodeName(encodeName(key))).toBe(key);
        expect(encodeName('a%b:c')).toBe('a%25b%3Ac');

        const root = makeDir();
        await new RecordStore(root).record('midgard', key, fetching({id: key}));
        expect(await new RecordStore(root, {offline: true}).record('midgard', key, fetching({id: 'x'}))).toEqual({id: key});
    });

    test('copies sort by fetch time: an old copy imported after a newer fetch still counts as older', async () => {
        const root = makeDir();
        const store = new RecordStore(root);
        await store.record('thornode', 'A', fetching<Tx>({id: 'A', gas: '2'}), RULES);
        store.importCopy('thornode', 'A', {id: 'A', gas: '1'}, RULES, {fetchedAt: null, importedFrom: 'old/A.json'});

        const copies = new RecordStore(root).copies<Tx>('thornode', 'A');
        expect(copies.map(c => [c.n, c.data.gas])).toEqual([[1, '1'], [0, '2']]);
        expect(await new RecordStore(root, {offline: true}).record('thornode', 'A', fetching<Tx>({id: 'A'}), RULES)).toEqual({id: 'A', gas: '2'});
    });

    test('a new copy never overwrites a file, even one written by another run', async () => {
        const root = makeDir();
        const first = new RecordStore(root);
        const second = new RecordStore(root);
        // second scans the store before first writes
        second.copies('thornode', 'B');
        await first.record('thornode', 'A', fetching<Tx>({id: 'A', gas: '1'}));
        await second.record('thornode', 'A', fetching<Tx>({id: 'A', gas: '2'}));

        expect(fs.readdirSync(path.join(root, 'records', 'thornode')).sort()).toEqual(['A-000.json', 'A-001.json']);
    });

    test('keys that differ only in case are refused', async () => {
        const root = makeDir();
        fs.outputJsonSync(path.join(root, 'records', 'viewblock', 'abc-000.json'), {});
        fs.outputJsonSync(path.join(root, 'records', 'viewblock', 'ABC-000.json'), {});

        if (fs.readdirSync(path.join(root, 'records', 'viewblock')).length === 2) {
            expect(() => new RecordStore(root).copies('viewblock', 'abc')).toThrow(/differ only in case/);
        }
    });
});

describe('Replay', () => {
    test('reads exactly the copies a run used, even after later changes', async () => {
        const root = makeDir();
        const run1 = new SnapshotManifest();
        await new RecordStore(root, {manifest: run1}).list('midgard', 'w', fetching([{id: 'a', gas: '1'}]), LIST);
        run1.write(path.join(root, 'run1'));

        await new RecordStore(root, {}).list('midgard', 'w', fetching([{id: 'a', gas: '2'}, {id: 'b'}]), LIST);

        const replay = new RecordStore(root, {replay: SnapshotManifest.load(path.join(root, 'run1'))});
        const fetch = fetching([] as Tx[]);
        expect(await replay.list('midgard', 'w', fetch, LIST)).toEqual([{id: 'a', gas: '1'}]);

        // A replay's own manifest can be replayed too
        const run2 = new SnapshotManifest();
        await new RecordStore(root, {replay: SnapshotManifest.load(path.join(root, 'run1')), manifest: run2}).list('midgard', 'w', fetch, LIST);
        expect(run2.findList('midgard', 'w')?.keys).toEqual(['a']);
        expect(fetch).not.toHaveBeenCalled();
        await expect(replay.record('thornode', 'other', fetching({id: 'other'}))).rejects.toThrow(StoreMissError);
    });

    test('fails if a stored copy no longer matches the manifest', async () => {
        const root = makeDir();
        const run = new SnapshotManifest();
        await new RecordStore(root, {manifest: run}).record('thornode', 'a', fetching({id: 'a'}));
        run.write(path.join(root, 'run'));

        const [copy] = new RecordStore(root).copies('thornode', 'a');
        fs.writeJSONSync(copy.file, {...fs.readJSONSync(copy.file), sha256: sha256({id: 'b'})});

        await expect(new RecordStore(root, {replay: SnapshotManifest.load(path.join(root, 'run'))}).record('thornode', 'a', fetching({id: 'a'})))
            .rejects.toThrow(/does not match the manifest/);
    });
});

describe('THORNODE_RULES', () => {
    test('drops the growing block count of an outbound never signed', () => {
        const tx = {stages: {outbound_signed: {scheduled_outbound_height: 1, blocks_since_scheduled: 99, completed: false}}};

        expect(THORNODE_RULES.normalise!(tx as any)).toEqual({stages: {outbound_signed: {scheduled_outbound_height: 1, completed: false}}});
    });
});

describe('RecordStore within one run', () => {
    test('a record shared by several wallets is fetched once, and keeps its changed status', async () => {
        const root = makeDir();
        await new RecordStore(root).record('thornode', 'a', fetching({id: 'a', gas: '1'}));

        const manifest = new SnapshotManifest();
        const store = new RecordStore(root, {fetch: 'all', manifest});
        const fetch = fetching<Tx>({id: 'a', gas: '2'});
        await store.record('thornode', 'a', fetch, RULES);
        await store.record('thornode', 'a', fetch, RULES);

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(manifest.findRecord('thornode', 'a')?.fetched).toBe('changed');
    });

    test("a list item stored again by a second wallet keeps the first wallet's changed status", async () => {
        const root = makeDir();
        await new RecordStore(root).list('midgard', 'w1', fetching([{id: 'a'}]), LIST);

        const manifest = new SnapshotManifest();
        const store = new RecordStore(root, {manifest});
        await store.list('midgard', 'w1', fetching([{id: 'a', gas: '1'}]), LIST);
        await store.list('midgard', 'w2', fetching([{id: 'a', gas: '1'}]), LIST);

        expect(manifest.findRecord('midgard', 'a')?.fetched).toBe('changed');
    });

    test('copies that differ only in what normalise drops are not a revision', () => {
        const rules = {normalise: ({gas, ...tx}: Tx) => tx};
        const copies = [{id: 'a', gas: '1'}, {id: 'a', gas: '2'}].map((data, n) => ({file: `${n}`, n, fetchedAt: `${n}`, sha256: sha256(data), data}));

        expect(chooseCopy(copies, rules).choice).toBe('only');
    });
});
