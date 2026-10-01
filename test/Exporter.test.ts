import { describe, expect, test } from '@jest/globals';
import { ActionTypeEnum } from '@xchainjs/xchain-midgard';
import { shouldFetchThornodeTx } from '../src/thorchain-exporter/Exporter';

describe('Exporter thornode fetch wiring', () => {
    test('should fetch thornode transactions for swaps', () => {
        expect(shouldFetchThornodeTx({ type: ActionTypeEnum.Swap, in: [{ txID: 'tx1' }] } as any)).toBe(true);
    });

    test('should keep fetching thornode transactions for switches', () => {
        expect(shouldFetchThornodeTx({ type: ActionTypeEnum.Switch, in: [{ txID: 'tx1' }] } as any)).toBe(true);
    });

    test('should not fetch thornode transactions for unrelated action types', () => {
        expect(shouldFetchThornodeTx({ type: ActionTypeEnum.Withdraw, in: [{ txID: 'tx1' }] } as any)).toBe(false);
    });

    test('should not fetch thornode transactions when the inbound tx has no id', () => {
        // e.g. 2021 BNB.RUNE switches returned by Midgard with an empty txID
        expect(shouldFetchThornodeTx({ type: ActionTypeEnum.Switch, in: [{ txID: '' }] } as any)).toBe(false);
    });
});
