import {describe, expect, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {Cache, CacheMissError, sha256} from '../src/cache/Cache';
import {SnapshotManifest} from '../src/cache/SnapshotManifest';

describe('Cache', () => {
    const makeDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-cache-'));

    test('online cache allows fetching on a miss', () => {
        const cache = new Cache(makeDir());

        expect(() => cache.assertCanFetch('missing')).not.toThrow();
    });

    test('offline cache throws on a miss instead of fetching', () => {
        const cache = new Cache(makeDir(), {offline: true});

        expect(() => cache.assertCanFetch('missing')).toThrow(CacheMissError);
    });

    test('offline cache still reads cached entries', () => {
        const dir = makeDir();
        new Cache(dir).write('key', {a: 1});
        const cache = new Cache(dir, {offline: true});

        expect(cache.has('key')).toBe(true);
        expect(cache.read('key')).toEqual({a: 1});
    });
});

describe('Cache snapshots', () => {
    const makeDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-snap-'));

    test('saves each fetch as a dated snapshot with its source URL and hash', () => {
        const dir = makeDir();
        new Cache(dir).write('wallet', [1], 'https://midgard/v2/actions?address=wallet');

        const [file] = new Cache(dir).snapshots('wallet');
        const saved = fs.readJSONSync(file);

        expect(path.dirname(file)).toBe(path.join(dir, 'wallet'));
        expect(saved.data).toEqual([1]);
        expect(saved.snapshot).toEqual({fetchedAt: expect.any(String), url: 'https://midgard/v2/actions?address=wallet', sha256: sha256([1])});
    });

    test('never overwrites: a changed fetch is a new snapshot, the latest is read', () => {
        const dir = makeDir();
        const cache = new Cache(dir);
        cache.write('wallet', [1]);
        cache.write('wallet', [1, 2]);

        expect(cache.snapshots('wallet')).toHaveLength(2);
        expect(cache.read('wallet')).toEqual([1, 2]);
    });

    test('an unchanged fetch adds no snapshot', () => {
        const dir = makeDir();
        const cache = new Cache(dir);
        cache.write('wallet', [1]);
        cache.write('wallet', [1]);

        expect(cache.snapshots('wallet')).toHaveLength(1);
    });

    test('reads a cache file from before snapshots as the oldest snapshot', () => {
        const dir = makeDir();
        fs.outputJsonSync(path.join(dir, 'wallet.json'), [1]);
        const cache = new Cache(dir);

        expect(cache.read('wallet')).toEqual([1]);

        cache.write('wallet', [1, 2]);
        expect(cache.snapshots('wallet')[0]).toBe(path.join(dir, 'wallet.json'));
        expect(cache.read('wallet')).toEqual([1, 2]);
    });

    test('refresh fetches refreshable sources again, but not per-tx records', () => {
        const dir = makeDir();
        new Cache(dir).write('key', 1);

        expect(new Cache(dir, {refresh: true}, {refreshable: true}).has('key')).toBe(false);
        expect(new Cache(dir, {refresh: true}).has('key')).toBe(true);
        expect(new Cache(dir, {refresh: true, offline: true}, {refreshable: true}).has('key')).toBe(true);
    });

    test('the manifest records what a run used, and replay reads exactly those snapshots', () => {
        const root = makeDir();
        const dir = path.join(root, 'midgard');
        const run1 = new SnapshotManifest(root);
        const cache = new Cache(dir, {manifest: run1});
        cache.write('wallet', [1]);
        cache.read('wallet');
        run1.write(path.join(root, 'run1'));

        expect(run1.list()).toEqual([expect.objectContaining({source: 'midgard', key: 'wallet', status: 'fetched'})]);

        // A later refresh finds a change
        const run2 = new SnapshotManifest(root);
        new Cache(dir, {refresh: true, manifest: run2}, {refreshable: true}).write('wallet', [1, 2]);
        expect(run2.list()[0].status).toBe('changed');

        // Replaying run 1 reads its snapshot, not the latest, and never fetches
        const replay = new Cache(dir, {replay: SnapshotManifest.load(path.join(root, 'run1'), root)});
        expect(replay.read('wallet')).toEqual([1]);
        expect(replay.has('other')).toBe(false);
        expect(() => replay.assertCanFetch('other')).toThrow(CacheMissError);
    });

    test('replay fails if a snapshot no longer matches the manifest', () => {
        const root = makeDir();
        const dir = path.join(root, 'thornode');
        const run = new SnapshotManifest(root);
        new Cache(dir, {manifest: run}).write('tx', {a: 1});
        run.write(path.join(root, 'run'));

        const [file] = new Cache(dir).snapshots('tx');
        const saved = fs.readJSONSync(file);
        fs.writeJSONSync(file, {...saved, snapshot: {...saved.snapshot, sha256: sha256({a: 2})}, data: {a: 2}});

        const replay = new Cache(dir, {replay: SnapshotManifest.load(path.join(root, 'run'), root)});
        expect(() => replay.read('tx')).toThrow(/does not match the manifest/);
    });
});
