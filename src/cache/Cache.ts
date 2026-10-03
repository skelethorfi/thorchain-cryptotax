import crypto from 'crypto';
import fs from 'fs-extra';
import * as path from "path";
import {SnapshotEntry, SnapshotManifest} from "./SnapshotManifest";

// Source data is kept as dated snapshots, never overwritten: THORNode prunes old txs and Midgard
// rewrites history, so a fetch may not be obtainable again. See docs/specs/snapshots.md.
//
// Layout: <cachePath>/<key>/<fetchedAt>.json, holding {snapshot: {fetchedAt, url, sha256}, data}.
// A cache from before snapshots, <cachePath>/<key>.json holding the data alone, is read as the oldest
// snapshot of that key.

export interface CacheOptions {
    // Only read from the cache. A cache miss throws instead of fetching from the network.
    offline?: boolean;
    // Fetch again any key whose source changes over time (e.g. a wallet's actions), even if cached.
    refresh?: boolean;
    // Read exactly the snapshots an earlier run used (its snapshots.json). Implies offline.
    replay?: SnapshotManifest;
    // Records every snapshot this run reads or writes
    manifest?: SnapshotManifest;
}

export interface CacheSourceOptions {
    // The data at a key can change after it was fetched (e.g. a wallet's action list), so --refresh
    // fetches it again. A single tx's record cannot gain anything from a refetch, only lose to pruning.
    refreshable?: boolean;
}

interface SnapshotMeta {
    fetchedAt: string | null;
    url?: string;
    sha256: string;
}

interface SnapshotFile {
    snapshot: SnapshotMeta;
    data: any;
}

export class CacheMissError extends Error {
    constructor(cachePath: string, key: string) {
        super(`Offline: no cached data for '${key}' in ${cachePath}`);
        this.name = 'CacheMissError';
    }
}

export function sha256(data: any): string {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export class Cache {
    cachePath: string;
    offline: boolean;
    private refresh: boolean;
    private replay?: SnapshotManifest;
    private manifest?: SnapshotManifest;

    constructor(cachePath: string, options: CacheOptions = {}, sourceOptions: CacheSourceOptions = {}) {
        this.cachePath = cachePath;
        this.replay = options.replay;
        this.offline = (options.offline ?? false) || !!options.replay;
        this.refresh = !this.offline && (options.refresh ?? false) && (sourceOptions.refreshable ?? false);
        this.manifest = options.manifest;
    }

    getPathForKey(key: string) {
        return path.join(this.cachePath, key + '.json');
    }

    has(key: string): boolean {
        if (this.replay) {
            return !!this.replay.find(this.cachePath, key);
        }

        return !this.refresh && !!this.latest(key);
    }

    read(key: string): any {
        const file = this.replay ? this.replayFile(key) : this.latest(key);

        if (!file) {
            throw new CacheMissError(this.cachePath, key);
        }

        const snapshot = this.load(file);

        if (this.replay) {
            const expected = this.replay.find(this.cachePath, key)!.sha256;

            if (snapshot.snapshot.sha256 !== expected) {
                throw new Error(`Replay: ${file} does not match the manifest (sha256 ${snapshot.snapshot.sha256}, expected ${expected})`);
            }
        }

        this.record(key, file, snapshot.snapshot, 'cached');

        return snapshot.data;
    }

    // Saves a new snapshot, unless it is the same as the latest one
    write(key: string, data: any, url?: string) {
        const hash = sha256(data);
        const latestFile = this.latest(key);
        const latest = latestFile ? this.load(latestFile) : undefined;

        if (latestFile && latest?.snapshot.sha256 === hash) {
            this.record(key, latestFile, latest.snapshot, 'unchanged');
            return;
        }

        // File names sort by time; two fetches in the same millisecond get the next one
        let time = Date.now();
        const fileAt = (t: number) => path.join(this.cachePath, key, `${new Date(t).toISOString().replace(/:/g, '-')}.json`);

        while (fs.existsSync(fileAt(time))) {
            time++;
        }

        const fetchedAt = new Date(time).toISOString();
        const file = fileAt(time);

        const snapshot: SnapshotMeta = {fetchedAt, ...(url ? {url} : {}), sha256: hash};
        fs.outputJsonSync(file, {snapshot, data}, {spaces: 4});

        if (latestFile) {
            console.log(`[Cache] Changed since ${latest?.snapshot.fetchedAt ?? 'the first fetch'}: ${path.join(this.cachePath, key)}`);
        }

        this.record(key, file, snapshot, latestFile ? 'changed' : 'fetched');
    }

    // Call before fetching data for a key that is not cached
    assertCanFetch(key: string) {
        if (this.offline) {
            throw new CacheMissError(this.cachePath, key);
        }
    }

    // All snapshot files of a key, oldest first; a pre-snapshot file counts as the oldest
    snapshots(key: string): string[] {
        const dir = path.join(this.cachePath, key);
        const files = fs.existsSync(dir) && fs.statSync(dir).isDirectory()
            ? fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => path.join(dir, name))
            : [];
        const legacy = this.getPathForKey(key);

        return fs.existsSync(legacy) ? [legacy, ...files] : files;
    }

    private latest(key: string): string | undefined {
        return this.snapshots(key).pop();
    }

    private replayFile(key: string): string | undefined {
        const entry = this.replay?.find(this.cachePath, key);
        return entry && this.replay!.resolve(entry);
    }

    private load(file: string): SnapshotFile {
        const content = fs.readJSONSync(file);

        if (content !== null && typeof content === 'object' && content.snapshot?.sha256 && 'data' in content) {
            return content;
        }

        // A cache file from before snapshots: the data alone, fetched at an unknown time
        return {snapshot: {fetchedAt: null, sha256: sha256(content)}, data: content};
    }

    private record(key: string, file: string, snapshot: SnapshotMeta, status: SnapshotEntry['status']) {
        this.manifest?.record(this.cachePath, key, file, {...snapshot, status});
    }
}
