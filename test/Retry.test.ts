import {describe, expect, jest, test} from '@jest/globals';
import {isTransient, withRetry} from '../src/utils/Retry';

describe('withRetry', () => {
    test('retries a transient error, then succeeds', async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        const fn = jest.fn<() => Promise<string>>()
            .mockRejectedValueOnce({response: {status: 502}})
            .mockResolvedValueOnce('ok');

        expect(await withRetry(fn, 'test', [0])).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    test('does not retry other errors, and gives up after the last delay', async () => {
        const notFound = jest.fn<() => Promise<string>>().mockRejectedValue({response: {status: 404}});
        await expect(withRetry(notFound, 'test', [0])).rejects.toEqual({response: {status: 404}});
        expect(notFound).toHaveBeenCalledTimes(1);

        jest.spyOn(console, 'log').mockImplementation(() => {});
        const down = jest.fn<() => Promise<string>>().mockRejectedValue({code: 'ECONNRESET'});
        await expect(withRetry(down, 'test', [0, 0])).rejects.toEqual({code: 'ECONNRESET'});
        expect(down).toHaveBeenCalledTimes(3);
    });

    test('knows which errors are transient', () => {
        expect(isTransient({response: {status: 504}})).toBe(true);
        expect(isTransient({response: {status: 429}})).toBe(true);
        expect(isTransient({message: 'fetch failed', cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}})).toBe(true);
        expect(isTransient({response: {status: 400}})).toBe(false);
        expect(isTransient(new Error('Offline: nothing stored'))).toBe(false);
    });
});
