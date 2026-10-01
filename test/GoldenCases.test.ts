import {describe, expect, test} from '@jest/globals';
import path from 'path';
import {findCaseDirs, readCaseExpected, readCaseInput, runCase} from '../src/fixtures/GoldenCase';

const CASES_DIR = path.join(__dirname, 'cases');
const caseDirs = findCaseDirs(CASES_DIR);
const name = (dir: string) => path.relative(CASES_DIR, dir);

// A case without expected.yaml is waiting for its mapper and a reviewed expected output
const reviewed = caseDirs.filter(dir => readCaseExpected(dir) !== undefined);
const pending = caseDirs.filter(dir => readCaseExpected(dir) === undefined);

describe('golden cases', () => {
    test('cases exist', () => {
        expect(reviewed.length).toBeGreaterThan(0);
    });

    test.each(reviewed.map(dir => [name(dir), dir]))('%s', (_name, dir) => {
        expect(runCase(readCaseInput(dir))).toStrictEqual(readCaseExpected(dir));
    });

    for (const dir of pending) {
        test.todo(`${name(dir)} (no expected.yaml yet)`);
    }
});
