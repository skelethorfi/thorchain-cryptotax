import {describe, expect, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {Cache, CacheMissError} from '../src/cache/Cache';

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
