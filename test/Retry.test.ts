import {describe, mock, test} from "node:test";
import assert from "node:assert/strict";
import {isTransient, withRetry} from '../src/sources/Retry.ts';

describe('withRetry', () => {
    test('retries a transient error, then succeeds', async () => {
        mock.method(console, 'log', () => {});
        const fn = mock.fn(async (): Promise<string> => 'ok');
        fn.mock.mockImplementationOnce(async () => { throw {response: {status: 502}}; });

        assert.equal(await withRetry(fn, 'test', [0]), 'ok');
        assert.equal(fn.mock.callCount(), 2);
    });

    test('does not retry other errors, and gives up after the last delay', async () => {
        const notFound = mock.fn(async (): Promise<string> => { throw {response: {status: 404}}; });
        await assert.rejects(withRetry(notFound, 'test', [0]), (e) => { assert.deepEqual(e, {response: {status: 404}}); return true; });
        assert.equal(notFound.mock.callCount(), 1);

        mock.method(console, 'log', () => {});
        const down = mock.fn(async (): Promise<string> => { throw {code: 'ECONNRESET'}; });
        await assert.rejects(withRetry(down, 'test', [0, 0]), (e) => { assert.deepEqual(e, {code: 'ECONNRESET'}); return true; });
        assert.equal(down.mock.callCount(), 3);
    });

    test('knows which errors are transient', () => {
        assert.equal(isTransient({response: {status: 504}}), true);
        assert.equal(isTransient({response: {status: 429}}), true);
        assert.equal(isTransient({message: 'fetch failed', cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}}), true);
        assert.equal(isTransient({response: {status: 400}}), false);
        assert.equal(isTransient(new Error('Offline: nothing stored')), false);
    });
});
