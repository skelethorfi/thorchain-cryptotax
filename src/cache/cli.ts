import fs from "fs-extra";
import path from "path";
import {RecordStore} from "./RecordStore";
import {SOURCES} from "./Sources";

// npm run store -- import <store> <old cache>...
//
// Copies every version of every record in old caches into a store (docs/specs/snapshots.md). Give the old
// caches oldest first: an old copy has no fetch time, so the order of import is the order of its copies.
// Identical copies are skipped, old files are left in place, and each imported copy says where it came from.

interface Counts {
    copies: number;
    existing: number;
    lists: number;
    skipped: number;
}

export function importCache(store: RecordStore, cacheRoot: string): {[source: string]: Counts} {
    const counts: {[source: string]: Counts} = {};
    const from = (file: string) => path.relative(path.dirname(store.root), file);

    for (const [source, definition] of Object.entries(SOURCES)) {
        const count = counts[source] = {copies: 0, existing: 0, lists: 0, skipped: 0};
        const add = (key: string, data: any, rules: any, origin: {fetchedAt: string | null, url?: string, importedFrom: string}) =>
            store.importCopy(source, key, data, rules, origin) ? count.copies++ : count.existing++;

        // A cache from before records: <source>/<key>.json (data only) and <source>/<key>/<time>.json ({snapshot, data})
        const legacyDir = path.join(cacheRoot, source);
        const legacy: {key: string, file: string, fetchedAt: string | null, url?: string, data: any}[] = [];

        if (fs.existsSync(legacyDir)) {
            for (const name of fs.readdirSync(legacyDir).sort()) {
                const file = path.join(legacyDir, name);

                if (name.endsWith('.json')) {
                    legacy.push({key: name.slice(0, -5), file, fetchedAt: null, data: fs.readJSONSync(file)});
                } else if (fs.statSync(file).isDirectory()) {
                    for (const snapshot of fs.readdirSync(file).filter(n => n.endsWith('.json')).sort()) {
                        const content = fs.readJSONSync(path.join(file, snapshot));
                        legacy.push({key: name, file: path.join(file, snapshot), fetchedAt: content.snapshot.fetchedAt, url: content.snapshot.url, data: content.data});
                    }
                }
            }
        }

        for (const old of legacy) {
            const origin = {fetchedAt: old.fetchedAt, url: old.url, importedFrom: from(old.file)};

            if (definition.kind === 'record') {
                add(old.key, old.data, definition.rules, origin);
                continue;
            }

            const wallet = old.key.replace(/^tcy_distribution_/, '');
            const options = definition.options(wallet);
            const all: any[] = options.legacyItems ? options.legacyItems(old.data) : old.data;
            const items = all.filter(item => !definition.skip?.(item));
            count.skipped += all.length - items.length;
            items.forEach(item => add(options.keyOf(item), item, options.rules ?? {}, origin));

            if (store.importList(source, wallet, items.map(options.keyOf), origin)) {
                count.lists++;
            }
        }

        // A store: records/<source>/<key>/<copy>.json and lists/<source>/<wallet>/<list>.json.
        // TCY records were first keyed by date alone (2026-10-03), which mixed wallets paid on the same day;
        // they can't be told apart, so they are left out (the same distributions come from the wallets' files).
        const oldTcyKey = (key: string) => source === 'tcy' && !key.includes('.');
        const recordsDir = path.join(cacheRoot, 'records', source);
        const rules = definition.kind === 'record' ? definition.rules : definition.options('').rules ?? {};

        for (const key of fs.existsSync(recordsDir) ? fs.readdirSync(recordsDir).sort().filter(key => !oldTcyKey(key)) : []) {
            for (const name of fs.readdirSync(path.join(recordsDir, key)).filter(n => n.endsWith('.json')).sort()) {
                const file = path.join(recordsDir, key, name);
                const copy = fs.readJSONSync(file);
                add(key, copy.data, rules, {fetchedAt: copy.fetchedAt, url: copy.url, importedFrom: copy.importedFrom ?? from(file)});
            }
        }

        const listsDir = path.join(cacheRoot, 'lists', source);

        for (const wallet of fs.existsSync(listsDir) ? fs.readdirSync(listsDir).sort() : []) {
            for (const name of fs.readdirSync(path.join(listsDir, wallet)).filter(n => n.endsWith('.json')).sort()) {
                const file = path.join(listsDir, wallet, name);
                const list = fs.readJSONSync(file);

                if (list.keys.some(oldTcyKey)) {
                    continue;
                }

                if (store.importList(source, wallet, list.keys, {fetchedAt: list.fetchedAt, url: list.url, importedFrom: list.importedFrom ?? from(file)})) {
                    count.lists++;
                }
            }
        }
    }

    return counts;
}

function main() {
    const [command, storeRoot, ...cacheRoots] = process.argv.slice(2);

    if (command !== 'import' || !storeRoot || cacheRoots.length === 0) {
        throw new Error('usage: npm run store -- import <store> <old cache>... (oldest first)');
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

if (require.main === module) {
    main();
}
