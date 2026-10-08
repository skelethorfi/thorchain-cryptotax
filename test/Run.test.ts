import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {type BundleResult, collectRows} from "../src/pipeline/run.ts";

const result = (time: string, id: string, failed = false): BundleResult => ({
    bundle: {} as any,
    time: new Date(time),
    activities: [],
    rows: [{id} as any],
    issues: failed ? [{kind: 'failed', message: 'x'}] : [],
});

describe('collectRows', () => {
    test('newest bundle first; bundles at the same time keep their listed order', () => {
        const rows = collectRows([
            result('2025-01-01', 'a'),
            result('2025-03-01', 'b'),
            result('2025-01-01', 'c'),
            result('2025-03-01', 'd'),
        ]);

        assert.deepEqual(rows.map(row => row.id), ['b', 'd', 'a', 'c']);
    });

    test('a failed bundle gives no rows', () => {
        assert.deepEqual(collectRows([result('2025-01-01', 'a', true), result('2025-01-01', 'b')]).map(row => row.id), ['b']);
    });
});
