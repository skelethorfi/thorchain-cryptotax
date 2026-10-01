import {describe, expect, test} from '@jest/globals';
import path from 'path';
import {findCaseDirs, readCaseExpected, readCaseInput, runCase} from '../src/fixtures/GoldenCase';

const CASES_DIR = path.join(__dirname, 'cases');
const caseDirs = findCaseDirs(CASES_DIR);

describe('golden cases', () => {
    test('cases exist', () => {
        expect(caseDirs.length).toBeGreaterThan(0);
    });

    test.each(caseDirs.map(dir => [path.relative(CASES_DIR, dir), dir]))('%s', (_name, dir) => {
        const expected = readCaseExpected(dir);

        if (expected === undefined) {
            throw new Error(`missing expected.yaml; review the output of 'npm run fixture -- show ${path.relative(process.cwd(), dir)}' and save it`);
        }

        expect(runCase(readCaseInput(dir))).toStrictEqual(expected);
    });
});
