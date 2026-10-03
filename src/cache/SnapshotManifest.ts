import fs from 'fs-extra';
import * as path from "path";

// The snapshots a run used, written to its output folder as snapshots.json, so the run can be
// replayed exactly (--replay). Paths are relative to the cache root (the config's cachePath).
// See docs/specs/snapshots.md.

export const MANIFEST_FILE = 'snapshots.json';

export interface SnapshotEntry {
    // Cache folder of the source, relative to the cache root, e.g. 'midgard'
    source: string;
    key: string;
    // Snapshot file, relative to the cache root
    file: string;
    fetchedAt: string | null;
    url?: string;
    sha256: string;
    // cached: read from an earlier fetch; fetched: first fetch of the key; unchanged: fetched again,
    // same as the latest snapshot; changed: fetched again and different, saved as a new snapshot
    status: 'cached' | 'fetched' | 'unchanged' | 'changed';
}

export class SnapshotManifest {
    private entries = new Map<string, SnapshotEntry>();

    constructor(public root: string, entries: SnapshotEntry[] = []) {
        entries.forEach(entry => this.entries.set(this.id(entry.source, entry.key), entry));
    }

    // A run folder or its snapshots.json; paths in it resolve against cacheRoot
    static load(runOrFile: string, cacheRoot: string): SnapshotManifest {
        const file = fs.existsSync(runOrFile) && fs.statSync(runOrFile).isDirectory() ? path.join(runOrFile, MANIFEST_FILE) : runOrFile;
        return new SnapshotManifest(cacheRoot, fs.readJSONSync(file).snapshots);
    }

    record(cachePath: string, key: string, file: string, meta: Omit<SnapshotEntry, 'source' | 'key' | 'file'>) {
        const source = this.source(cachePath);
        const id = this.id(source, key);
        const previous = this.entries.get(id);

        // A key fetched or changed in this run keeps that status when it is read again
        if (previous && previous.status !== 'cached' && meta.status === 'cached') {
            return;
        }

        this.entries.set(id, {source, key, file: path.relative(this.root, file), ...meta});
    }

    find(cachePath: string, key: string): SnapshotEntry | undefined {
        return this.entries.get(this.id(this.source(cachePath), key));
    }

    resolve(entry: SnapshotEntry): string {
        return path.join(this.root, entry.file);
    }

    list(): SnapshotEntry[] {
        return [...this.entries.values()].sort((a, b) => a.file.localeCompare(b.file));
    }

    write(outputPath: string) {
        const snapshots = this.list();
        const changed = snapshots.filter(entry => entry.status === 'changed');

        fs.outputJsonSync(path.join(outputPath, MANIFEST_FILE), {snapshots}, {spaces: 2});
        console.log(`Snapshots: ${snapshots.length} used, ${changed.length} changed since their last fetch`);
        changed.forEach(entry => console.log(`  changed: ${entry.source}/${entry.key}`));
    }

    private source(cachePath: string): string {
        return path.relative(this.root, cachePath);
    }

    private id(source: string, key: string): string {
        return `${source}/${key}`;
    }
}
