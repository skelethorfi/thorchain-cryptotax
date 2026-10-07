import {afterEach, describe, expect, jest, test} from "@jest/globals";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {renderSummary, RunSummary, SUMMARY_FILE} from "../src/cli/RunSummary";

describe('RunSummary', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('prints each line as before and keeps it for summary.md, with the action key on issues', () => {
        const log = jest.spyOn(console, 'log').mockImplementation(() => {});
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        const summary = new RunSummary();

        summary.about('Mode: offline');
        summary.info('Total exported: 2');
        summary.warn('WARN: wallet not found in config: thor1x');
        summary.issue('manual', '2025-01-01T00:00:00.000Z loan: enter by hand: x', 'midgard/swap.A');
        summary.issue('failed', '2025-01-02T00:00:00.000Z contract: bad asset', 'midgard/contract.B');

        expect(log.mock.calls).toEqual([['Total exported: 2']]);
        expect(warn.mock.calls).toEqual([['WARN: wallet not found in config: thor1x'], ['2025-01-01T00:00:00.000Z loan: enter by hand: x']]);
        expect(error.mock.calls).toEqual([['2025-01-02T00:00:00.000Z contract: bad asset']]);
        expect(renderSummary(summary)).toBe([
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
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-summary-'));
        const summary = new RunSummary();
        summary.warn('Found a cache:\n  npm run store -- import a b');

        summary.write(dir);

        expect(fs.readFileSync(path.join(dir, SUMMARY_FILE), 'utf8')).toContain('- Found a cache:   npm run store -- import a b\n');
    });
});
