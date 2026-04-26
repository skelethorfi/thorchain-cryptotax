import { describe, expect, test } from '@jest/globals';
import { ActionTypeEnum } from '@xchainjs/xchain-midgard';
import { shouldFetchThornodeTx } from '../src/thorchain-exporter/Exporter';

describe('Exporter thornode fetch wiring', () => {
    test('should fetch thornode transactions for swaps', () => {
        expect(shouldFetchThornodeTx({ type: ActionTypeEnum.Swap } as any)).toBe(true);
    });

    test('should keep fetching thornode transactions for switches', () => {
        expect(shouldFetchThornodeTx({ type: ActionTypeEnum.Switch } as any)).toBe(true);
    });

    test('should not fetch thornode transactions for unrelated action types', () => {
        expect(shouldFetchThornodeTx({ type: ActionTypeEnum.Withdraw } as any)).toBe(false);
    });
});
