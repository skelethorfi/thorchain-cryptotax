import {describe, test} from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {diffRecords, diffRows, diffRuns, explain, parseCsv, parseCsvLine, type Row} from "../src/cli/diff.ts";
import {type CryptoTaxTransaction, renderCsv} from "../src/export/summ/csv/index.ts";
import type {RecordEntry} from "../src/sources/store/SnapshotManifest.ts";

const TX_A = 'A1'.repeat(32);
const TX_B = 'b2'.repeat(32);

const tx = (time: string, amount: string, txid: string, extra: Partial<CryptoTaxTransaction> = {}): CryptoTaxTransaction => ({
    timestamp: new Date(time),
    type: 'receive' as any,
    baseCurrency: 'RUNE',
    baseAmount: amount,
    from: 'thorchain',
    to: 'thor1wallet',
    description: `Receive ${amount} RUNE; ${txid}`,
    id: `${time}.receive`,
    ...extra,
});

const rows = (txs: CryptoTaxTransaction[]): Row[] => parseCsv(renderCsv(txs));

const record = (key: string, sha256: string, choice = 'only'): RecordEntry =>
    ({source: 'midgard', key, file: `records/midgard/${key}.0.json`, fetchedAt: null, sha256, choice, copies: 1});

describe('parseCsv', () => {
    test('reads what renderCsv writes, quotes and commas included', () => {
        const [row] = rows([tx('2025-07-01T00:00:00Z', '1', TX_A, {description: 'a "b", c; ' + TX_A})]);

        assert.deepEqual(parseCsvLine('a,"b ""c"", d",'), ['a', 'b "c", d', '']);
        assert.equal(row['Description (Optional)'], 'a "b", c; ' + TX_A);
        assert.equal(row['ID (Optional)'], '2025-07-01T00:00:00Z.receive');
    });
});

describe('diffRows', () => {
    test('a row added before others leaves them equal', () => {
        const old = rows([tx('2025-07-02T00:00:00Z', '1', TX_A)]);
        const now = rows([tx('2025-07-02T00:00:00Z', '1', TX_A), tx('2025-07-01T00:00:00Z', '2', TX_B)]);

        const diff = diffRows(old, now);

        assert.equal(diff.removed.length, 0);
        assert.equal(diff.changed.length, 0);
        assert.deepEqual(diff.added.map(row => row['Base Amount']), ['2']);
    });

    test('rows are multisets: one of two identical rows removed', () => {
        const same = tx('2025-07-01T00:00:00Z', '1', TX_A);

        assert.equal(diffRows(rows([same, same]), rows([same])).removed.length, 1);
    });

    test('a removed and an added row with the same time, type, base currency, from and to are one changed row', () => {
        const diff = diffRows(rows([tx('2025-07-01T00:00:00Z', '1', TX_A)]), rows([tx('2025-07-01T00:00:00Z', '1.5', TX_A)]));

        assert.equal(diff.removed.length, 0);
        assert.equal(diff.added.length, 0);
        assert.deepEqual(diff.changed.map(change => change.columns), [['Base Amount', 'Description (Optional)']]);
    });
});

describe('diffRecords and explain', () => {
    const changes = diffRecords(
        [record(`swap.${TX_A}`, 'x'), record(`send.${TX_B}`, 'y'), record('tcy.wallet.1', 'z')],
        [record(`swap.${TX_A}`, 'x2', 'revised'), record('tcy.wallet.1', 'z'), record(`refund.${TX_B}`, 'w')],
    );

    test('a record differs when only one run has it or the runs used different copies', () => {
        assert.deepEqual(changes.map(change => [change.key, change.change]), [
            [`refund.${TX_B}`, 'only-new'],
            [`send.${TX_B}`, 'only-old'],
            [`swap.${TX_A}`, 'changed'],
        ]);
    });

    test('a row is explained by differing records whose key holds a txid of its description, case ignored', () => {
        const [row] = rows([tx('2025-07-01T00:00:00Z', '1', TX_A.toLowerCase())]);
        const [other] = rows([tx('2025-07-01T00:00:00Z', '1', 'C3'.repeat(32))]);

        assert.deepEqual(explain(row, changes).map(change => change.key), [`swap.${TX_A}`]);
        assert.deepEqual(explain(other, changes), []);
    });
});

describe('diffRuns', () => {
    const writeRun = (dir: string, files: {[name: string]: CryptoTaxTransaction[]}, records: RecordEntry[]) => {
        Object.entries(files).forEach(([name, txs]) => fs.outputFileSync(path.join(dir, 'csv', name), renderCsv(txs)));
        fs.outputJsonSync(path.join(dir, 'snapshots.json'), {layout: 3, records, lists: []});
    };

    test('identical runs: no differences', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-diff-'));
        const files = {'all.csv': [tx('2025-07-01T00:00:00Z', '1', TX_A)]};
        writeRun(path.join(root, 'old'), files, [record(`swap.${TX_A}`, 'x')]);
        writeRun(path.join(root, 'new'), files, [record(`swap.${TX_A}`, 'x')]);

        const result = diffRuns(path.join(root, 'old'), path.join(root, 'new'));

        assert.equal(result.differs, false);
        assert.ok(result.lines.includes('Records: none differ, so every difference comes from code or config'));
    });

    test('a changed row names its record; a row moved between files differs even when all.csv does not', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-diff-'));
        const a = tx('2025-07-01T00:00:00Z', '1', TX_A);
        const b = tx('2025-06-30T20:00:00Z', '2', TX_B);
        writeRun(path.join(root, 'old'), {'all.csv': [a, b], 'p1.csv': [a, b]}, [record(`swap.${TX_A}`, 'x'), record(`send.${TX_B}`, 'y')]);
        writeRun(path.join(root, 'new'), {'all.csv': [{...a, baseAmount: '1.5'}, b], 'p1.csv': [{...a, baseAmount: '1.5'}], 'p0.csv': [b]},
            [record(`swap.${TX_A}`, 'x2', 'revised'), record(`send.${TX_B}`, 'y')]);

        const {lines, differs} = diffRuns(path.join(root, 'old'), path.join(root, 'new'));
        const text = lines.join('\n');

        assert.equal(differs, true);
        assert.ok(text.includes('0 removed, 0 added, 1 changed'));
        assert.ok(text.includes('Base Amount: 1 → 1.5'));
        assert.ok(text.includes(`← midgard swap.${TX_A}: another copy (revised)`));
        // b moved from p1 to p0 and is listed under both; a's change is listed once, from all.csv
        assert.ok(text.includes('p0.csv: 0 → 1 rows; 0 only in the old run, 1 only in the new run\n    + 2025-06-30T20:00:00.000Z receive 2 RUNE'));
        assert.ok(text.includes('p1.csv: 2 → 1 rows; 2 only in the old run, 1 only in the new run\n    - 2025-06-30T20:00:00.000Z receive 2 RUNE'));
        assert.equal(text.match(/1\.5 RUNE/g)!.length, 1);
    });

    test('a folder without csv/all.csv is refused', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-diff-'));

        assert.throws(() => diffRuns(root, root), /not a run folder/);
    });
});
