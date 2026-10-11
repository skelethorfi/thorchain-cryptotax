import {describe, test} from "node:test";
import assert from "node:assert/strict";
import fs from 'fs';
import path from 'path';
import {
    findCaseDirs, readCaseActivities, readCaseExpected, readCaseInput, runCase, runCaseLayers, toBundle, toCaseInput, toPlainActivity,
} from '../src/fixtures/GoldenCase.ts';

const CASES_DIR = path.join(import.meta.dirname, 'cases');
const caseDirs = findCaseDirs(CASES_DIR);
const name = (dir: string) => path.relative(CASES_DIR, dir);

// A case without expected.yaml is waiting for its mapper and a reviewed expected output
const reviewed = caseDirs.filter(dir => readCaseExpected(dir) !== undefined);
const pending = caseDirs.filter(dir => readCaseExpected(dir) === undefined);

describe('golden cases', () => {
    test('cases exist', () => {
        assert.ok(reviewed.length > 0);
    });

    for (const dir of reviewed) {
        test(name(dir), () => {
            assert.deepEqual(runCase(readCaseInput(dir)), readCaseExpected(dir));
        });
    }

    // Every case is checked at both layers, so an interpreter bug and an exporter bug fail
    // different checks
    for (const dir of reviewed) {
        test(`${name(dir)} activity.yaml`, () => {
            const activities = runCaseLayers(readCaseInput(dir)).activities.map(toPlainActivity);
            assert.deepEqual(activities, readCaseActivities(dir) ?? []);
        });
    }

    // The fixture tool writes input.json from a RawBundle, so every case must survive the round trip
    for (const dir of caseDirs) {
        test(`${name(dir)} input.json is a RawBundle`, () => {
            const {treatment, ...input} = readCaseInput(dir);
            assert.deepEqual(toCaseInput(toBundle(input), input.description), input);
        });
    }

    // An anonymised case is reviewed, and its TO-REVIEW.md deleted, before it is committed
    // (docs/specs/fixtures.md). Locally that is the pre-commit hook's job; in CI, fail if one got through.
    const awaitingReview = caseDirs.filter(dir => fs.existsSync(path.join(dir, 'TO-REVIEW.md')));

    if (process.env.CI) {
        test('no case is awaiting a privacy review', () => {
            assert.deepEqual(awaitingReview.map(name), []);
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
