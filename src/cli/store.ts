import fs from "fs-extra";
import path from "path";
import type {Action} from "@xchainjs/xchain-midgard";
import {type Origin, RecordStore} from "../sources/store/RecordStore.ts";
import {type ListSource, SOURCES} from "../sources/store/Sources.ts";

// npm run store -- import <store> <old cache or store>...
//
// Copies every version of every record into a store (docs/specs/snapshots.md), from:
// - an old cache: <source>/<key>.json (one response) and <source>/<key>/<time>.json ({snapshot, data});
// - a store with a folder per record (October 2026): records/<source>/<key>/<copy>.json, lists likewise;
// - a store in the current layout.
// Give them oldest first: a copy from an old cache has no fetch time, so the order of import is the order of
// its copies. Identical copies are skipped, the sources are left in place, and each imported copy from an old
// cache says where it came from.

interface Counts {
    copies: number;
    existing: number;
    lists: number;
    skipped: number;
}

export function importCache(store: RecordStore, cacheRoot: string): {[source: string]: Counts} {
    const counts: {[source: string]: Counts} = {};
    const from = (file: string) => path.relative(path.dirname(store.root), file);

    let txDates: Map<string, Date> | undefined;

    // SOURCES lists Midgard before THORNode and Cosmos, so their txs can be dated by the actions just imported
    for (const [source, definition] of Object.entries(SOURCES)) {
        const count = counts[source] = {copies: 0, existing: 0, lists: 0, skipped: 0};
        const rulesFor = (wallet: string) => definition.kind === 'record' ? definition.rules : definition.options(wallet).rules ?? {};
        const dateOf = (key: string) => definition.kind === 'record' ? (txDates ??= actionDates(store)).get(key.toUpperCase()) : undefined;
        const add = (key: string, data: any, wallet: string, origin: Origin) =>
            store.importCopy(source, key, data, rulesFor(wallet), origin, dateOf(key)) ? count.copies++ : count.existing++;
        const addList = (wallet: string, keys: string[], origin: Origin) => {
            if (store.importList(source, wallet, keys, origin)) {
                count.lists++;
            }
        };

        for (const old of legacyFiles(path.join(cacheRoot, source))) {
            const origin = {fetchedAt: old.fetchedAt, url: old.url, importedFrom: from(old.file)};

            if (definition.kind === 'record') {
                add(old.key, old.data, '', origin);
                continue;
            }

            const wallet = definition.legacyWallet ? definition.legacyWallet(old.key) : old.key;
            const keys = importItems(definition, wallet, definition.legacyItems ? definition.legacyItems(old.data) : old.data, count,
                (key, item) => add(key, item, wallet, origin));
            addList(wallet, keys, origin);
        }

        importStore(cacheRoot, source, definition, add, addList);
    }

    return counts;
}

// The date of each inbound txid, from the Midgard actions in the store: a THORNode or Cosmos tx has no
// date of its own, so it is filed by the action it belongs to
function actionDates(store: RecordStore): Map<string, Date> {
    const dates = new Map<string, Date>();

    for (const source of ['midgard', 'maya-midgard']) {
        for (const key of store.keys(source)) {
            const action = store.copies<Action>(source, key)[0].data;
            const date = new Date(Number(action.date) / 1e6);

            for (const txId of action.in.map(tx => tx.txID?.toUpperCase()).filter(Boolean)) {
                const known = dates.get(txId);
                dates.set(txId, known && known < date ? known : date);
            }
        }
    }

    return dates;
}

// Items of one wallet fetch, without the ones its source leaves out (genesisTx placeholders); returns their keys
function importItems(definition: ListSource, wallet: string, all: any[], count: Counts, add: (key: string, item: any) => void): string[] {
    const options = definition.options(wallet);
    const items = all.filter(item => !definition.skip?.(item));
    count.skipped += all.length - items.length;
    items.forEach(item => add(options.keyOf(item), item));

    return items.map(options.keyOf);
}

const WALLET_KEYED = ['tcy', 'maya-distribution'];

// A store, in either layout. A record's key is recomputed from its data where the source has a keyOf, so
// a store made with older keys gets today's.
function importStore(root: string, source: string, definition: ListSource | {kind: 'record'},
                     add: (key: string, data: any, wallet: string, origin: Origin) => void,
                     addList: (wallet: string, keys: string[], origin: Origin) => void) {
    const keyOf = definition.kind === 'list' ? definition.options('').keyOf : undefined;
    // Keys of the folder-per-record layout (its folder names) → today's keys, to translate its lists
    const renamed = new Map<string, string>();

    for (const file of walk(path.join(root, 'records', source)).sort()) {
        const copy = fs.readJSONSync(file);
        const folderKey = path.basename(path.dirname(file));
        // TCY records were first keyed by date alone (2026-10-03), which mixed wallets paid on the same day;
        // they can't be told apart, so they are left out (the wallets' own old files hold the same data)
        if (source === 'tcy' && !copy.key && !folderKey.includes('.')) {
            continue;
        }

        const oldKey = copy.key ?? folderKey;
        // A key with the wallet in it (TCY, CACAO to MAYA holders) can't be recomputed from the record alone
        const key = WALLET_KEYED.includes(source) ? oldKey : keyOf ? keyOf(copy.data) : oldKey;
        renamed.set(oldKey, key);
        renamed.set(v1Folder(oldKey), key);
        add(key, copy.data, '', {fetchedAt: copy.fetchedAt, url: copy.url, importedFrom: copy.importedFrom ?? path.relative(path.dirname(root), file)});
    }

    for (const file of walk(path.join(root, 'lists', source)).sort()) {
        const list = fs.readJSONSync(file);

        if (source === 'tcy' && list.keys.some((key: string) => !key.includes('.'))) {
            continue;
        }

        const wallet = list.wallet ?? path.basename(path.dirname(file));
        const keys = list.keys.map((key: string) => renamed.get(key) ?? renamed.get(v1Folder(key)) ?? key);
        addList(wallet, keys, {fetchedAt: list.fetchedAt, url: list.url, importedFrom: list.importedFrom ?? path.relative(path.dirname(root), file)});
    }
}

// The folder name a key had in the folder-per-record layout
function v1Folder(key: string): string {
    return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

function legacyFiles(dir: string): {key: string, file: string, fetchedAt: string | null, url?: string, data: any}[] {
    const files: {key: string, file: string, fetchedAt: string | null, url?: string, data: any}[] = [];

    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
        const file = path.join(dir, name);

        if (name.endsWith('.json')) {
            files.push({key: name.slice(0, -5), file, fetchedAt: null, data: fs.readJSONSync(file)});
        } else if (fs.statSync(file).isDirectory()) {
            for (const snapshot of fs.readdirSync(file).filter(n => n.endsWith('.json')).sort()) {
                const content = fs.readJSONSync(path.join(file, snapshot));
                files.push({key: name, file: path.join(file, snapshot), fetchedAt: content.snapshot.fetchedAt, url: content.snapshot.url, data: content.data});
            }
        }
    }

    return files;
}

function walk(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }

    return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry =>
        entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.json') ? [path.join(dir, entry.name)] : []);
}

// A cache from before the store, which runs no longer read: the store folder itself (a config whose
// cachePath still points at it) or cache/ next to the config. Returns the import command to suggest, while
// the store holds nothing yet.
export function oldCacheHint(storePath: string, configDir: string): string | undefined {
    if (walk(path.join(storePath, 'records')).length > 0) {
        return undefined;
    }

    const isOldCache = (dir: string) => Object.keys(SOURCES).some(source =>
        fs.existsSync(path.join(dir, source)) && fs.readdirSync(path.join(dir, source)).some(name => name.endsWith('.json')));
    const oldCache = [storePath, path.join(configDir, 'cache')].find(isOldCache);

    return oldCache && `npm run store -- import ${path.relative(process.cwd(), storePath) || '.'} ${path.relative(process.cwd(), oldCache) || '.'}`;
}

function main() {
    const [command, storeRoot, ...cacheRoots] = process.argv.slice(2);

    if (command !== 'import' || !storeRoot || cacheRoots.length === 0) {
        throw new Error('usage: npm run store -- import <store> <old cache or store>... (oldest first)');
    }

    const store = new RecordStore(path.resolve(storeRoot));

    for (const cacheRoot of cacheRoots) {
        console.log(`Importing ${cacheRoot}`);

        for (const [source, count] of Object.entries(importCache(store, path.resolve(cacheRoot)))) {
            if (count.copies || count.existing || count.lists || count.skipped) {
                console.log(`  ${source}: ${count.copies} copies added, ${count.existing} already stored, ${count.lists} lists added` +
                    (count.skipped ? `, ${count.skipped} genesisTx placeholders left out` : ''));
            }
        }
    }
}

if (import.meta.main) {
    main();
}
