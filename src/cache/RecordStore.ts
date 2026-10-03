import crypto from 'crypto';
import fs from 'fs-extra';
import * as path from "path";
import {SnapshotManifest} from "./SnapshotManifest";
import {withRetry} from "../utils/Retry";

// Source data is stored one record (an action, a tx) per file, and a record that comes back different is
// stored again as a new copy, never overwritten. A run picks one copy of each record by rules (the good
// copy over a pruned one, a finalised copy over a pending one) and lists the copies it used in its
// manifest, so it can be replayed exactly. See docs/specs/snapshots.md.
//
//   <storePath>/records/<source>/<key>/<fetchedAt>.json   one copy of a record
//   <storePath>/lists/<source>/<wallet>/<fetchedAt>.json  the record keys one fetch of a wallet returned
//
// Caches from before (<storePath>/<source>/<key>.json holding a whole response) are imported on first use.

export type FetchMode = 'missing' | 'latest' | 'all';

export interface StoreOptions {
    // Only read stored records. Anything not stored is an error instead of a fetch.
    offline?: boolean;
    // What to fetch beyond what is not stored yet (docs/specs/snapshots.md):
    // missing (default): nothing more; latest: every wallet list again, and records still pending;
    // all: every list and record again
    fetch?: FetchMode;
    // Read exactly the copies an earlier run used (its snapshots.json). Implies offline.
    replay?: SnapshotManifest;
    // Records every copy this run uses
    manifest?: SnapshotManifest;
}

export interface Fetched<T> {
    data: T;
    url?: string;
}

// How a source's records compare, for choosing between copies
export interface RecordRules<T = any> {
    // Not final yet, e.g. a Midgard action with status 'pending'
    isPending?: (data: T) => boolean;
    // More is better; a copy with less (e.g. a THORNode tx pruned of its gas) is not used
    completeness?: (data: T) => number;
    // Drops what changes on every fetch but is not source data (e.g. a value at today's price), before
    // a copy is compared and stored; also applied to imported caches
    normalise?: (data: T) => T;
}

// How a list is found in a cache from before records
export interface ListOptions<T> {
    keyOf: (item: T) => string;
    rules?: RecordRules<T>;
    // The old cache key, if not the wallet
    legacyKey?: string;
    // The items in an old cached response, if it was not the list itself
    legacyItems?: (data: any) => T[];
}

// What a fetch did: the record's first copy, a new copy, or the same as the latest copy
type FetchStatus = 'new' | 'changed' | 'unchanged';

interface Stored<T> {
    copy: Copy<T>;
    status: FetchStatus;
}

export interface Copy<T = any> {
    file: string;
    fetchedAt: string | null;
    url?: string;
    // Where an imported copy came from (an old cache file)
    importedFrom?: string;
    sha256: string;
    data: T;
}

// Why a copy is used
export type Choice = 'only' | 'finalised' | 'revised' | 'kept-over-pruned';

export class StoreMissError extends Error {
    constructor(what: string) {
        super(`Offline: nothing stored for ${what}`);
        this.name = 'StoreMissError';
    }
}

export function sha256(data: any): string {
    return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// Record keys become folder names
export function safeKey(key: string): string {
    return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

// Picks the copy to use: copies oldest first, each later one replaces the choice unless it has less in it.
// Copies that differ only in what the source's normalise drops (stored before it was added) count as the same.
export function chooseCopy<T>(copies: Copy<T>[], rules: RecordRules<T> = {}): {copy: Copy<T>, choice: Choice, ignored: Copy<T>[]} {
    const completeness = rules.completeness ?? (() => 0);
    const isPending = rules.isPending ?? (() => false);
    const same = (a: Copy<T>, b: Copy<T>) => a.sha256 === b.sha256
        || (!!rules.normalise && sha256(rules.normalise(a.data)) === sha256(rules.normalise(b.data)));
    let copy = copies[0];
    let choice: Choice = 'only';
    const ignored: Copy<T>[] = [];

    for (const next of copies.slice(1)) {
        if (same(next, copy)) {
            continue;
        }

        if (completeness(next.data) < completeness(copy.data)) {
            ignored.push(next);
            choice = 'kept-over-pruned';
        } else {
            choice = isPending(copy.data) && !isPending(next.data) ? 'finalised' : 'revised';
            copy = next;
        }
    }

    return {copy, choice, ignored};
}

export class RecordStore {
    readonly offline: boolean;
    private readonly fetchMode: FetchMode;
    private readonly replay?: SnapshotManifest;
    private readonly manifest?: SnapshotManifest;
    // Records and lists fetched in this run: one shared by several wallets is fetched once
    private readonly fetchedThisRun = new Set<string>();

    constructor(readonly root: string, options: StoreOptions = {}) {
        this.replay = options.replay;
        this.offline = (options.offline ?? false) || !!options.replay;
        this.fetchMode = this.offline ? 'missing' : options.fetch ?? 'missing';
        this.manifest = options.manifest;
    }

    // One record, e.g. a THORNode tx
    async record<T>(source: string, key: string, fetch: () => Promise<Fetched<T>>, rules: RecordRules<T> = {}): Promise<T> {
        if (this.replay) {
            return this.replayRecord(source, key);
        }

        this.importLegacyRecord(source, key, rules);

        let fetchedNow: Stored<T> | undefined;

        if (this.shouldFetchRecord(source, key, rules)) {
            this.assertCanFetch(`${source} ${key}`);
            const fetched = await withRetry(fetch, `${source} ${key}`);
            fetchedNow = this.store(source, key, fetched.data, rules, fetched.url);
        }

        return this.use(source, key, rules, fetchedNow);
    }

    // A wallet's records, e.g. its Midgard actions. Records that an earlier fetch returned and a later one
    // didn't are kept, and flagged as missing from the source.
    async list<T>(source: string, wallet: string, fetch: () => Promise<Fetched<T[]>>, options: ListOptions<T>): Promise<T[]> {
        const {keyOf, rules = {}} = options;

        if (this.replay) {
            const list = this.replay.findList(source, wallet);

            if (!list) {
                throw new StoreMissError(`${source} list ${wallet} in the replayed run`);
            }

            this.manifest?.recordList(list);

            return list.keys.map(key => this.replayRecord(source, key));
        }

        this.importLegacyList(source, wallet, options);

        let fetchedNow = new Map<string, Stored<T>>();

        if (this.shouldFetchList(source, wallet)) {
            this.assertCanFetch(`${source} list ${wallet}`);
            const fetched = await withRetry(fetch, `${source} list ${wallet}`);
            fetchedNow = this.storeList(source, wallet, fetched.data, options, fetched.url);
        }

        const lists = this.lists(source, wallet);
        const latest = lists[lists.length - 1]?.keys ?? [];
        const earlier = [...new Set(lists.slice(0, -1).flatMap(list => list.keys))].filter(key => !latest.includes(key));
        const keys = [...latest, ...earlier];

        this.manifest?.recordList({source, wallet, keys, missing: earlier, file: this.relative(lists[lists.length - 1]?.file)});

        return keys.map(key => this.use(source, key, rules, fetchedNow.get(key), earlier.includes(key)));
    }

    // A record not stored yet is always fetched. With fetch 'latest' a pending one is fetched again, as it
    // may since be finalised; a finalised one can only come back revised or pruned, which 'all' looks for.
    private shouldFetchRecord<T>(source: string, key: string, rules: RecordRules<T>): boolean {
        const copies = this.copies<T>(source, key);
        const wanted = copies.length === 0
            || this.fetchMode === 'all'
            || (this.fetchMode === 'latest' && !!rules.isPending?.(chooseCopy(copies, rules).copy.data));

        return wanted && this.firstFetchThisRun(`records/${source}/${key}`);
    }

    // A wallet's list is fetched again with 'latest' or 'all', for new activity and changed records
    private shouldFetchList(source: string, wallet: string): boolean {
        const wanted = this.lists(source, wallet).length === 0 || this.fetchMode !== 'missing';
        return wanted && this.firstFetchThisRun(`lists/${source}/${wallet}`);
    }

    private firstFetchThisRun(id: string): boolean {
        if (this.fetchedThisRun.has(id)) {
            return false;
        }

        this.fetchedThisRun.add(id);
        return true;
    }

    // Adds a copy from an old cache, unless the same copy (after normalising) is already stored. With no
    // fetchedAt, it sorts before every fetched copy, after earlier imports.
    importCopy<T>(source: string, key: string, data: T, rules: RecordRules<T>, origin: {fetchedAt: string | null, url?: string, importedFrom: string}): boolean {
        const normalised = rules.normalise ? rules.normalise(data) : data;
        const hash = sha256(normalised);
        const same = (copy: Copy<T>) => (rules.normalise ? sha256(rules.normalise(copy.data)) : copy.sha256) === hash;

        if (this.copies<T>(source, key).some(same)) {
            return false;
        }

        const file = this.newFile(path.join(this.root, 'records', source, safeKey(key)), origin.fetchedAt);
        fs.outputJsonSync(file, {fetchedAt: origin.fetchedAt, ...(origin.url ? {url: origin.url} : {}), importedFrom: origin.importedFrom, sha256: hash, data: normalised}, {spaces: 2});

        return true;
    }

    // Adds what one old fetch of a wallet returned, unless a stored list has the same keys
    importList(source: string, wallet: string, keys: string[], origin: {fetchedAt: string | null, url?: string, importedFrom: string}): boolean {
        if (this.lists(source, wallet).some(list => JSON.stringify(list.keys) === JSON.stringify(keys))) {
            return false;
        }

        const file = this.newFile(path.join(this.root, 'lists', source, safeKey(wallet)), origin.fetchedAt);
        fs.outputJsonSync(file, {fetchedAt: origin.fetchedAt, ...(origin.url ? {url: origin.url} : {}), importedFrom: origin.importedFrom, keys}, {spaces: 2});

        return true;
    }

    assertCanFetch(what: string) {
        if (this.offline) {
            throw new StoreMissError(what);
        }
    }

    // All stored copies of a record, oldest first
    copies<T>(source: string, key: string): Copy<T>[] {
        const dir = path.join(this.root, 'records', source, safeKey(key));

        if (!fs.existsSync(dir)) {
            return [];
        }

        return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort()
            .map(name => ({file: path.join(dir, name), ...fs.readJSONSync(path.join(dir, name))}));
    }

    private use<T>(source: string, key: string, rules: RecordRules<T>, fetchedNow?: Stored<T>, missing = false): T {
        const copies = this.copies<T>(source, key);

        if (copies.length === 0) {
            throw new StoreMissError(`${source} ${key}`);
        }

        const {copy, choice, ignored} = chooseCopy(copies, rules);

        if (fetchedNow && ignored.some(c => c.sha256 === fetchedNow.copy.sha256)) {
            console.log(`[Store] ${source} ${key}: fetched a copy with less in it (pruned?); using the copy of ${copy.fetchedAt ?? 'the first fetch'}`);
        }

        this.manifest?.recordRecord({
            source, key, file: this.relative(copy.file), fetchedAt: copy.fetchedAt, url: copy.url, sha256: copy.sha256,
            choice, copies: copies.length,
            ...(missing ? {missing: true} : {}),
            ...(fetchedNow ? {fetched: fetchedNow.status} : {}),
        });

        return copy.data;
    }

    private replayRecord<T>(source: string, key: string): T {
        const entry = this.replay!.findRecord(source, key);

        if (!entry) {
            throw new StoreMissError(`${source} ${key} in the replayed run`);
        }

        const copy: Copy<T> = fs.readJSONSync(path.join(this.root, entry.file));

        if (copy.sha256 !== entry.sha256) {
            throw new Error(`Replay: ${entry.file} does not match the manifest (sha256 ${copy.sha256}, expected ${entry.sha256})`);
        }

        this.manifest?.recordRecord({...entry});

        return copy.data;
    }

    // Stores a copy unless it is the same as the latest stored copy
    private store<T>(source: string, key: string, fetchedData: T, rules: RecordRules<T>, url?: string, fetchedAt?: string | null): Stored<T> {
        const data = rules.normalise ? rules.normalise(fetchedData) : fetchedData;
        const hash = sha256(data);
        const copies = this.copies<T>(source, key);
        const latest = copies[copies.length - 1];

        if (latest?.sha256 === hash) {
            return {copy: latest, status: 'unchanged'};
        }

        const at = fetchedAt === undefined ? new Date().toISOString() : fetchedAt;
        const file = this.newFile(path.join(this.root, 'records', source, safeKey(key)), at);
        const copy = {fetchedAt: at, ...(url ? {url} : {}), sha256: hash, data};
        fs.outputJsonSync(file, copy, {spaces: 2});

        return {copy: {file, ...copy}, status: latest ? 'changed' : 'new'};
    }

    private storeList<T>(source: string, wallet: string, items: T[], {keyOf, rules = {}}: ListOptions<T>, url?: string,
                         fetchedAt?: string | null): Map<string, Stored<T>> {
        const stored = new Map<string, Stored<T>>();

        for (const item of items) {
            const key = keyOf(item);

            if (stored.has(key)) {
                throw new Error(`${source} ${wallet}: two records with the key ${key}`);
            }

            stored.set(key, this.store(source, key, item, rules, url, fetchedAt));
        }

        const keys = [...stored.keys()];
        const lists = this.lists(source, wallet);

        if (JSON.stringify(lists[lists.length - 1]?.keys) !== JSON.stringify(keys)) {
            const at = fetchedAt === undefined ? new Date().toISOString() : fetchedAt;
            const file = this.newFile(path.join(this.root, 'lists', source, safeKey(wallet)), at);
            fs.outputJsonSync(file, {fetchedAt: at, ...(url ? {url} : {}), keys}, {spaces: 2});
        }

        return stored;
    }

    private lists(source: string, wallet: string): {file: string, keys: string[]}[] {
        const dir = path.join(this.root, 'lists', source, safeKey(wallet));

        if (!fs.existsSync(dir)) {
            return [];
        }

        return fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort()
            .map(name => ({file: path.join(dir, name), keys: fs.readJSONSync(path.join(dir, name)).keys}));
    }

    // File names sort by fetch time; an import of unknown time sorts first. Two in one millisecond get the next.
    private newFile(dir: string, fetchedAt: string | null): string {
        if (fetchedAt === null) {
            const fileFor = (n: number) => path.join(dir, `0000-imported-${String(n).padStart(4, '0')}.json`);
            let n = 0;
            while (fs.existsSync(fileFor(n))) n++;
            return fileFor(n);
        }

        let time = new Date(fetchedAt).getTime();
        const fileAt = (t: number) => path.join(dir, `${new Date(t).toISOString().replace(/:/g, '-')}.json`);

        while (fs.existsSync(fileAt(time))) {
            time++;
        }

        return fileAt(time);
    }

    // A cache from before: <source>/<key>.json (data only), and <source>/<key>/<time>.json ({snapshot, data})
    private legacyFiles(source: string, key: string): {fetchedAt: string | null, url?: string, data: any}[] {
        const files: {fetchedAt: string | null, url?: string, data: any}[] = [];
        const single = path.join(this.root, source, `${key}.json`);
        const dir = path.join(this.root, source, key);

        if (fs.existsSync(single)) {
            files.push({fetchedAt: null, data: fs.readJSONSync(single)});
        }

        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            for (const name of fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort()) {
                const content = fs.readJSONSync(path.join(dir, name));
                files.push({fetchedAt: content.snapshot.fetchedAt, url: content.snapshot.url, data: content.data});
            }
        }

        return files;
    }

    private importLegacyRecord<T>(source: string, key: string, rules: RecordRules<T>) {
        if (this.copies(source, key).length > 0) {
            return;
        }

        for (const legacy of this.legacyFiles(source, key)) {
            this.store(source, key, legacy.data, rules, legacy.url, legacy.fetchedAt);
        }
    }

    private importLegacyList<T>(source: string, wallet: string, options: ListOptions<T>) {
        if (this.lists(source, wallet).length > 0) {
            return;
        }

        for (const legacy of this.legacyFiles(source, options.legacyKey ?? wallet)) {
            const items = options.legacyItems ? options.legacyItems(legacy.data) : legacy.data;
            this.storeList(source, wallet, items, options, legacy.url, legacy.fetchedAt);
        }
    }

    private relative(file?: string): string {
        return file ? path.relative(this.root, file) : '';
    }
}
