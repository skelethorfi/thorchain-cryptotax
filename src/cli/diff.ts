import fs from "fs-extra";
import path from "path";
import {MANIFEST_FILE, type RecordEntry} from "../sources/store/SnapshotManifest.ts";

// npm run diff -- <old run> <new run>
//
// Compares the CSV rows of two runs, ignoring the ID column, and tags each differing row with the source
// records that differ between the runs' snapshots and share a txid with it (docs/specs/run-diff.md). Exits 1
// when any CSV file's rows differ.

export type Row = {[column: string]: string};

const ID = 'ID (Optional)';
const DESCRIPTION = 'Description (Optional)';
const TIMESTAMP = 'Timestamp (UTC)';
// A removed and an added row that agree on these are one changed row
const PAIR_COLUMNS = [TIMESTAMP, 'Type', 'Base Currency', 'From (Optional)', 'To (Optional)'];
const TXID = /[0-9a-f]{64}/gi;

export interface RecordChange {
    source: string;
    key: string;
    change: 'changed' | 'only-old' | 'only-new';
    choice?: string;
}

export interface ChangedRow {
    old: Row;
    new: Row;
    columns: string[];
}

export interface RowDiff {
    removed: Row[];
    added: Row[];
    changed: ChangedRow[];
}

// One CSV line: fields are quoted when they hold a comma or a quote, with quotes doubled (csvField)
export function parseCsvLine(line: string): string[] {
    const fields: string[] = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (quoted) {
            if (char === '"' && line[i + 1] === '"') {
                field += '"';
                i++;
            } else if (char === '"') {
                quoted = false;
            } else {
                field += char;
            }
        } else if (char === '"') {
            quoted = true;
        } else if (char === ',') {
            fields.push(field);
            field = '';
        } else {
            field += char;
        }
    }

    fields.push(field);
    return fields;
}

// Rows never span lines: renderCsv writes newlines as '; '
export function parseCsv(text: string): Row[] {
    const [header, ...lines] = text.split('\n').filter(line => line.length > 0);

    if (!header) {
        return [];
    }

    const columns = parseCsvLine(header);
    return lines.map(line => {
        const fields = parseCsvLine(line);
        return Object.fromEntries(columns.map((column, i) => [column, fields[i] ?? '']));
    });
}

function rowKey(row: Row, columns: string[]): string {
    return columns.map(column => row[column] ?? '').join('\u0000');
}

function columnsOf(rows: Row[]): string[] {
    return [...new Set(rows.flatMap(row => Object.keys(row)))].filter(column => column !== ID).sort();
}

// Rows in only one run, as multisets, ignoring ID
export function rowsOnlyIn(oldRows: Row[], newRows: Row[]): {removed: Row[]; added: Row[]} {
    const columns = columnsOf([...oldRows, ...newRows]);
    const unmatched = new Map<string, Row[]>();

    for (const row of oldRows) {
        const key = rowKey(row, columns);
        unmatched.set(key, [...unmatched.get(key) ?? [], row]);
    }

    const added: Row[] = [];

    for (const row of newRows) {
        const match = unmatched.get(rowKey(row, columns));

        if (match?.length) {
            match.shift();
        } else {
            added.push(row);
        }
    }

    return {removed: [...unmatched.values()].flat(), added};
}

// Rows in only one run, with each removed row that has an added counterpart (PAIR_COLUMNS) shown as changed
export function diffRows(oldRows: Row[], newRows: Row[]): RowDiff {
    const {removed, added} = rowsOnlyIn(oldRows, newRows);
    const columns = columnsOf([...oldRows, ...newRows]);
    const candidates = new Map<string, Row[]>();
    added.forEach(row => {
        const key = rowKey(row, PAIR_COLUMNS);
        candidates.set(key, [...candidates.get(key) ?? [], row]);
    });

    const changed: ChangedRow[] = [];
    const unpaired: Row[] = [];

    for (const row of removed) {
        const match = candidates.get(rowKey(row, PAIR_COLUMNS))?.shift();

        if (match) {
            changed.push({old: row, new: match, columns: columns.filter(column => (row[column] ?? '') !== (match[column] ?? ''))});
        } else {
            unpaired.push(row);
        }
    }

    const paired = new Set(changed.map(change => change.new));
    return {removed: unpaired, added: added.filter(row => !paired.has(row)), changed};
}

// Records in only one manifest, or whose runs used different copies
export function diffRecords(oldRecords: RecordEntry[], newRecords: RecordEntry[]): RecordChange[] {
    const id = (entry: RecordEntry) => `${entry.source}/${entry.key}`;
    const olds = new Map(oldRecords.map(entry => [id(entry), entry]));
    const news = new Map(newRecords.map(entry => [id(entry), entry]));
    const changes: RecordChange[] = [];

    for (const [key, entry] of news) {
        const old = olds.get(key);

        if (!old) {
            changes.push({source: entry.source, key: entry.key, change: 'only-new', choice: entry.choice});
        } else if (old.sha256 !== entry.sha256) {
            changes.push({source: entry.source, key: entry.key, change: 'changed', choice: entry.choice});
        }
    }

    for (const [key, entry] of olds) {
        if (!news.has(key)) {
            changes.push({source: entry.source, key: entry.key, change: 'only-old', choice: entry.choice});
        }
    }

    return changes.sort((a, b) => `${a.source}/${a.key}`.localeCompare(`${b.source}/${b.key}`));
}

// The differing records that share a txid with the row's description
export function explain(row: Row, changes: RecordChange[]): RecordChange[] {
    const txids = new Set((row[DESCRIPTION]?.match(TXID) ?? []).map(txid => txid.toUpperCase()));
    return changes.filter(change => (change.key.match(TXID) ?? []).some(txid => txids.has(txid.toUpperCase())));
}

export function describeChange(change: RecordChange): string {
    const what = change.change === 'changed' ? `another copy (${change.choice})` : change.change === 'only-old' ? 'only in the old run' : 'only in the new run';
    return `${change.source} ${change.key}: ${what}`;
}

function describeRow(row: Row): string {
    const quote = row['Quote Currency (Optional)'] ? ` / ${row['Quote Amount (Optional)']} ${row['Quote Currency (Optional)']}` : '';
    return `${row[TIMESTAMP]} ${row['Type']} ${row['Base Amount']} ${row['Base Currency']}${quote}; ${row[DESCRIPTION] ?? ''}`;
}

function readRows(file: string): Row[] {
    return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
}

function readRecords(run: string): RecordEntry[] | undefined {
    const file = path.join(run, MANIFEST_FILE);
    return fs.existsSync(file) ? fs.readJSONSync(file).records ?? [] : undefined;
}

function csvNames(run: string): string[] {
    const dir = path.join(run, 'csv');
    return fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.csv')) : [];
}

// The report's lines, and whether any file's rows differ
export function diffRuns(oldRun: string, newRun: string): {lines: string[]; differs: boolean} {
    for (const run of [oldRun, newRun]) {
        if (!fs.existsSync(path.join(run, 'csv', 'all.csv'))) {
            throw new Error(`${run} is not a run folder: it has no csv/all.csv`);
        }
    }

    const lines: string[] = [];
    const oldRows = readRows(path.join(oldRun, 'csv', 'all.csv'));
    const newRows = readRows(path.join(newRun, 'csv', 'all.csv'));
    const rows = diffRows(oldRows, newRows);
    const oldRecords = readRecords(oldRun);
    const newRecords = readRecords(newRun);
    const records = oldRecords && newRecords ? diffRecords(oldRecords, newRecords) : undefined;

    lines.push(`Rows (all.csv, ${oldRows.length} → ${newRows.length}): ${rows.removed.length} removed, ${rows.added.length} added, ${rows.changed.length} changed`);

    if (!records) {
        lines.push(`Records: not compared (a run has no ${MANIFEST_FILE})`);
    } else if (records.length === 0) {
        lines.push('Records: none differ, so every difference comes from code or config');
    } else {
        const count = (change: RecordChange['change']) => records.filter(record => record.change === change).length;
        lines.push(`Records: ${records.length} differ (${count('changed')} another copy, ${count('only-old')} only in the old run, ${count('only-new')} only in the new run)`);
    }

    const tag = (row: Row) => {
        if (!records) {
            return '';
        }

        const explained = explain(row, records);
        return explained.length ? explained.map(change => `\n    ← ${describeChange(change)}`).join('') : '\n    ← no record change';
    };
    const entries = [
        ...rows.removed.map(row => ({time: row[TIMESTAMP], text: `- ${describeRow(row)}${tag(row)}`})),
        ...rows.added.map(row => ({time: row[TIMESTAMP], text: `+ ${describeRow(row)}${tag(row)}`})),
        ...rows.changed.map(({old, new: row, columns}) => ({
            time: row[TIMESTAMP],
            text: `~ ${describeRow(row)}\n    ${columns.map(column => `${column}: ${old[column] ?? ''} → ${row[column] ?? ''}`).join('\n    ')}${tag(row)}`,
        })),
    ].sort((a, b) => a.time.localeCompare(b.time));

    if (entries.length) {
        lines.push('', ...entries.map(entry => entry.text));
    }

    // A file's differing rows are listed only when all.csv has them unchanged: a row moved between files
    const columns = columnsOf([...oldRows, ...newRows]);
    const listed = new Set([...rows.removed, ...rows.added, ...rows.changed.flatMap(change => [change.old, change.new])].map(row => rowKey(row, columns)));
    const files = [...new Set([...csvNames(oldRun), ...csvNames(newRun)])].sort();
    const fileLines = files.flatMap(name => {
        const olds = readRows(path.join(oldRun, 'csv', name));
        const news = readRows(path.join(newRun, 'csv', name));
        const {removed, added} = rowsOnlyIn(olds, news);
        const unlisted = (row: Row) => !listed.has(rowKey(row, columns));
        const moved = [...removed.filter(unlisted).map(row => `- ${describeRow(row)}`), ...added.filter(unlisted).map(row => `+ ${describeRow(row)}`)];
        return removed.length || added.length
            ? [`  ${name}: ${olds.length} → ${news.length} rows; ${removed.length} only in the old run, ${added.length} only in the new run`, ...moved.map(line => `    ${line}`)]
            : [];
    });

    if (fileLines.length) {
        lines.push('', 'Files whose rows differ:', ...fileLines);
    }

    return {lines, differs: fileLines.length > 0};
}

function main() {
    const [oldRun, newRun] = process.argv.slice(2);

    if (!oldRun || !newRun) {
        throw new Error('usage: npm run diff -- <old run> <new run>');
    }

    const {lines, differs} = diffRuns(path.resolve(oldRun), path.resolve(newRun));
    console.log(lines.join('\n'));
    console.log(differs ? '\nThe runs differ.' : '\nThe runs have the same rows (ignoring ID).');
    process.exitCode = differs ? 1 : 0;
}

if (import.meta.main) {
    main();
}
