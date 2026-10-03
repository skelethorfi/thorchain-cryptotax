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

    test('refresh stores a changed copy next to the old one; an unchanged one adds nothing', async () => {
        const root = makeDir();
        await new RecordStore(root).record('thornode', 'a', fetching({id: 'a', gas: '1'}));
        await new RecordStore(root, {refresh: true}).record('thornode', 'a', fetching({id: 'a', gas: '1'}));
        expect(new RecordStore(root).copies('thornode', 'a')).toHaveLength(1);

        const used = await new RecordStore(root, {refresh: true}).record('thornode', 'a', fetching({id: 'a', gas: '2'}), RULES);
        expect(used).toEqual({id: 'a', gas: '2'});
        expect(new RecordStore(root).copies('thornode', 'a')).toHaveLength(2);
    });

    test('a pruned copy is stored, but the earlier good copy is used', async () => {
        const root = makeDir();
        jest.spyOn(console, 'log').mockImplementation(() => {});
        await new RecordStore(root).record('thornode', 'a', fetching({id: 'a', gas: '1'}), RULES);

        const used = await new RecordStore(root, {refresh: true}).record('thornode', 'a', fetching({id: 'a'}), RULES);

        expect(used).toEqual({id: 'a', gas: '1'});
        expect(new RecordStore(root).copies('thornode', 'a')).toHaveLength(2);
    });

    test('a finalised copy is used over the pending one, which is kept', async () => {
        const root = makeDir();
        await new RecordStore(root).record('thornode', 'a', fetching({id: 'a', status: 'pending'}), RULES);

        const used = await new RecordStore(root, {refresh: true}).record('thornode', 'a', fetching({id: 'a', status: 'done'}), RULES);

        expect(used).toEqual({id: 'a', status: 'done'});
        expect(new RecordStore(root).copies<Tx>('thornode', 'a').map(c => c.data.status)).toEqual(['pending', 'done']);
    });
});

describe('chooseCopy', () => {
    const copy = (data: Tx, n: number): Copy<Tx> => ({file: `${n}`, fetchedAt: `${n}`, sha256: sha256(data), data});

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

        expect(fs.readdirSync(path.join(root, 'records', 'midgard')).sort()).toEqual(['a', 'b']);
        expect(store.copies('midgard', 'b')).toHaveLength(1);
    });

    test('on refresh: new items are added, finalised ones replace pending ones, and missing ones are kept', async () => {
        const root = makeDir();
        await new RecordStore(root).list('midgard', 'w', fetching([{id: 'old'}, {id: 'gone'}, {id: 'p', status: 'pending'}]), LIST);

        const manifest = new SnapshotManifest();
        const items = await new RecordStore(root, {refresh: true, manifest})
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
        await new RecordStore(root, {refresh: true}).list('viewblock', 'w', fetching([{id: 'a', now: '2'}]), options);

        expect(new RecordStore(root).copies('viewblock', 'a').map(c => c.data)).toEqual([{id: 'a'}]);
    });

    test('an empty list is stored, so offline runs can replay it', async () => {
        const root = makeDir();
        await new RecordStore(root).list('viewblock', 'w', fetching([] as Tx[]), LIST);

        expect(await new RecordStore(root, {offline: true}).list('viewblock', 'w', fetching([{id: 'x'}]), LIST)).toEqual([]);
    });

    test('imports a cache from before records: a whole response per wallet, and per-fetch snapshots', async () => {
        const root = makeDir();
        fs.outputJsonSync(path.join(root, 'tcy', 'tcy_distribution_w.json'), {distributions: [{id: 'a'}]});
        fs.outputJsonSync(path.join(root, 'tcy', 'tcy_distribution_w', '2026-10-03T00-00-00.000Z.json'),
            {snapshot: {fetchedAt: '2026-10-03T00:00:00.000Z', sha256: 'x'}, data: {distributions: [{id: 'a'}, {id: 'b'}]}});
        const options = {...LIST, legacyKey: 'tcy_distribution_w', legacyItems: (data: any) => data.distributions};

        const items = await new RecordStore(root, {offline: true}).list('tcy', 'w', fetching([] as Tx[]), options);

        expect(items).toEqual([{id: 'a'}, {id: 'b'}]);
        expect(new RecordStore(root).copies('tcy', 'a')[0].fetchedAt).toBeNull();
        expect(new RecordStore(root).copies('tcy', 'b')[0].fetchedAt).toBe('2026-10-03T00:00:00.000Z');
    });
});

describe('Replay', () => {
    test('reads exactly the copies a run used, even after later changes', async () => {
        const root = makeDir();
        const run1 = new SnapshotManifest();
        await new RecordStore(root, {manifest: run1}).list('midgard', 'w', fetching([{id: 'a', gas: '1'}]), LIST);
        run1.write(path.join(root, 'run1'));

        await new RecordStore(root, {refresh: true}).list('midgard', 'w', fetching([{id: 'a', gas: '2'}, {id: 'b'}]), LIST);

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
        const store = new RecordStore(root, {refresh: true, manifest});
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
        const store = new RecordStore(root, {refresh: true, manifest});
        await store.list('midgard', 'w1', fetching([{id: 'a', gas: '1'}]), LIST);
        await store.list('midgard', 'w2', fetching([{id: 'a', gas: '1'}]), LIST);

        expect(manifest.findRecord('midgard', 'a')?.fetched).toBe('changed');
    });

    test('copies that differ only in what normalise drops are not a revision', () => {
        const rules = {normalise: ({gas, ...tx}: Tx) => tx};
        const copies = [{id: 'a', gas: '1'}, {id: 'a', gas: '2'}].map((data, n) => ({file: `${n}`, fetchedAt: `${n}`, sha256: sha256(data), data}));

        expect(chooseCopy(copies, rules).choice).toBe('only');
    });
});
