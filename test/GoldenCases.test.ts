import {describe, expect, test} from '@jest/globals';
import path from 'path';
import {
    findCaseDirs, readCaseActivities, readCaseExpected, readCaseInput, runCase, runCaseLayers, toBundle, toCaseInput, toPlainActivity,
} from '../src/fixtures/GoldenCase';

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

    // A ported action type is checked at both layers, so an interpreter bug and an exporter bug fail
    // different checks
    test.each(reviewed.map(dir => [name(dir), dir]))('%s activity.yaml', (_name, dir) => {
        const activities = runCaseLayers(readCaseInput(dir)).activities.map(toPlainActivity);
        expect(activities).toStrictEqual(readCaseActivities(dir) ?? []);
    });

    // The fixture tool writes input.json from a RawBundle, so every case must survive the round trip
    test.each(caseDirs.map(dir => [name(dir), dir]))('%s input.json is a RawBundle', (_name, dir) => {
        const input = readCaseInput(dir);
        expect(toCaseInput(toBundle(input), input.description)).toStrictEqual(input);
    });

    for (const dir of pending) {
        test.todo(`${name(dir)} (no expected.yaml yet)`);
    }
});
