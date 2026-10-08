import {afterEach, describe, mock, test} from "node:test";
import assert from "node:assert/strict";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {renderSummary, RunSummary, SUMMARY_FILE} from "../src/cli/RunSummary.ts";

describe('RunSummary', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    test('prints each line as before and keeps it for summary.md, with the action key on issues', () => {
        const log = mock.method(console, 'log', () => {});
        const warn = mock.method(console, 'warn', () => {});
        const error = mock.method(console, 'error', () => {});
        const summary = new RunSummary();

        summary.about('Mode: offline');
        summary.info('Total exported: 2');
        summary.warn('WARN: wallet not found in config: thor1x');
        summary.issue('manual', '2025-01-01T00:00:00.000Z loan: enter by hand: x', 'midgard/swap.A');
        summary.issue('failed', '2025-01-02T00:00:00.000Z contract: bad asset', 'midgard/contract.B');

        assert.deepEqual(log.mock.calls.map(call => call.arguments), [['Total exported: 2']]);
        assert.deepEqual(warn.mock.calls.map(call => call.arguments), [['WARN: wallet not found in config: thor1x'], ['2025-01-01T00:00:00.000Z loan: enter by hand: x']]);
        assert.deepEqual(error.mock.calls.map(call => call.arguments), [['2025-01-02T00:00:00.000Z contract: bad asset']]);
        assert.equal(renderSummary(summary), [
            '# Run summary',
            '', '## Run', '', '- Mode: offline',
            '', '## Counts', '', '- Total exported: 2',
            '', '## Warnings (1)', '', '- WARN: wallet not found in config: thor1x',
            '', '## Enter by hand (1)', '', '- 2025-01-01T00:00:00.000Z loan: enter by hand: x (midgard/swap.A)',
            '', '## Failed actions (saved in failures/ with their error) (1)', '', '- 2025-01-02T00:00:00.000Z contract: bad asset (midgard/contract.B)',
            '',
        ].join('\n'));
    });

    test('writes summary.md to the run folder; a line with a newline stays one list item', () => {
        mock.method(console, 'warn', () => {});
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-summary-'));
        const summary = new RunSummary();
        summary.warn('Found a cache:\n  npm run store -- import a b');

        summary.write(dir);

        assert.ok(fs.readFileSync(path.join(dir, SUMMARY_FILE), 'utf8').includes('- Found a cache:   npm run store -- import a b\n'));
    });
});
