import {describe, expect, test} from '@jest/globals';
import fs from 'fs';
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
        const {treatment, ...input} = readCaseInput(dir);
        expect(toCaseInput(toBundle(input), input.description)).toStrictEqual(input);
    });

    // An anonymised case is reviewed, and its TO-REVIEW.md deleted, before it is committed
    // (docs/specs/fixtures.md). Locally that is the pre-commit hook's job; in CI, fail if one got through.
    const awaitingReview = caseDirs.filter(dir => fs.existsSync(path.join(dir, 'TO-REVIEW.md')));

    if (process.env.CI) {
        test('no case is awaiting a privacy review', () => {
            expect(awaitingReview.map(name)).toEqual([]);
        });
    } else {
        for (const dir of awaitingReview) {
            test.todo(`${name(dir)} (anonymised: awaiting privacy review)`);
        }
    }

    for (const dir of pending) {
        test.todo(`${name(dir)} (no expected.yaml yet)`);
    }
});
