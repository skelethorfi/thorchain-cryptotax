import { describe, expect, test } from '@jest/globals';
import { ActionTypeEnum } from '@xchainjs/xchain-midgard';
import { getThornodeTxIds, shouldIncludeAction } from '../src/thorchain-exporter/Exporter';

describe('Exporter thornode fetch wiring', () => {
    const inbound = (txID: string, asset?: string) => ({ txID, coins: asset ? [{ asset, amount: '1' }] : [] });
    const ids = (type: string, ins: any[]) => getThornodeTxIds({ type, in: ins } as any);

    test('fetches the inbound thornode transaction for swaps, switches and refunds', () => {
        expect(ids(ActionTypeEnum.Swap, [inbound('tx1', 'THOR.RUNE')])).toEqual(['tx1']);
        expect(ids(ActionTypeEnum.Switch, [inbound('tx1', 'GAIA.KUJI')])).toEqual(['tx1']);
        expect(ids(ActionTypeEnum.Refund, [inbound('tx1', 'BTC.BTC')])).toEqual(['tx1']);
    });

    test('fetches only the L1 deposits of an add liquidity', () => {
        expect(ids(ActionTypeEnum.AddLiquidity, [inbound('tx-rune', 'THOR.RUNE'), inbound('tx-btc', 'BTC.BTC')])).toEqual(['tx-btc']);
        expect(ids(ActionTypeEnum.AddLiquidity, [inbound('tx-rune', 'THOR.RUNE')])).toEqual([]);
    });

    test('fetches a withdrawal request only when it was sent on an L1', () => {
        expect(ids(ActionTypeEnum.Withdraw, [inbound('tx-btc', 'BTC.BTC')])).toEqual(['tx-btc']);
        expect(ids(ActionTypeEnum.Withdraw, [inbound('tx-rune')])).toEqual([]);
        expect(ids(ActionTypeEnum.Withdraw, [inbound('tx-rune', 'THOR.RUNE')])).toEqual([]);
    });

    test('does not fetch thornode transactions for unrelated action types', () => {
        expect(ids(ActionTypeEnum.Donate, [inbound('tx1', 'BTC.BTC')])).toEqual([]);
    });

    test('does not fetch thornode transactions when the inbound tx has no id', () => {
        // e.g. 2021 BNB.RUNE switches returned by Midgard with an empty txID
        expect(ids(ActionTypeEnum.Switch, [inbound('', 'BNB.RUNE-B1A')])).toEqual([]);
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

    test('includes a pending loan open with an output: it was paid out (docs/specs/loans.md)', () => {
        expect(shouldIncludeAction(action('pending', 'loanOpen', [rune]))).toBe(true);
        expect(shouldIncludeAction(action('pending', 'loanOpen', [{asset: 'BTC.BTC', amount: '1000'}]))).toBe(true);
    });

    test('excludes a pending loan open with no output', () => {
        expect(shouldIncludeAction(action('pending', 'loanOpen'))).toBe(false);
    });
});
