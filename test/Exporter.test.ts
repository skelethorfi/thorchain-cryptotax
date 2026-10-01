import { describe, expect, test } from '@jest/globals';
import { ActionTypeEnum } from '@xchainjs/xchain-midgard';
import { shouldFetchThornodeTx, shouldIncludeAction } from '../src/thorchain-exporter/Exporter';

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

describe('Exporter action status filter', () => {
    const action = (status: string, txType: string, outCoins: any[] = []) =>
        ({status, type: 'swap', metadata: {swap: {txType}}, out: outCoins.length ? [{coins: outCoins}] : []} as any);
    const rune = {asset: 'THOR.RUNE', amount: '130314435243'};

    test('includes successful actions', () => {
        expect(shouldIncludeAction(action('success', 'swap'))).toBe(true);
    });

    test('excludes pending swaps', () => {
        expect(shouldIncludeAction(action('pending', 'swap', [rune]))).toBe(false);
    });

    test('includes pending loan repayments (loan not closed)', () => {
        expect(shouldIncludeAction(action('pending', 'loanRepayment'))).toBe(true);
    });

    test('includes a pending loan open that paid out the loan', () => {
        // e.g. a 2024 loan open reported as success at the time, and as pending since late 2024
        expect(shouldIncludeAction(action('pending', 'loanOpen', [rune]))).toBe(true);
    });

    test('excludes a pending loan open with no output', () => {
        expect(shouldIncludeAction(action('pending', 'loanOpen'))).toBe(false);
    });
});
