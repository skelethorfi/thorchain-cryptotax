import {describe, expect, test} from '@jest/globals';
import {NotFinal, pendingAge} from '../src/sources/Pending';
import {MidgardSource} from '../src/sources/Source';
import {MAYA, THORCHAIN} from '../src/domain/Protocol';

const DAY = 86400_000;

describe('pendingAge', () => {
    const today = new Date(Date.UTC(2026, 6, 31));
    const daysAgo = (days: number) => new Date(today.getTime() - days * DAY);

    test('recent within the grace period, stuck from the cut-off, waiting in between', () => {
        expect(pendingAge(daysAgo(2.9), today, 3, 30)).toBe('recent');
        expect(pendingAge(daysAgo(3), today, 3, 30)).toBe('waiting');
        expect(pendingAge(daysAgo(29.9), today, 3, 30)).toBe('waiting');
        expect(pendingAge(daysAgo(30), today, 3, 30)).toBe('stuck');
    });
});

describe('MidgardSource actions that are not final', () => {
    const nanos = (date: Date) => (date.getTime() * 1e6).toString();
    const date = new Date(Date.UTC(2023, 0, 8));
    const action = (type: string, status: string, txID: string, txType?: string) => ({
        type, status, date: nanos(date), height: '1', pools: [],
        in: [{address: 'thor1wallet', txID, coins: [{asset: 'THOR.RUNE', amount: '100'}]}], out: [],
        metadata: txType ? {swap: {txType}} : {},
    } as any);
    const source = (protocol: typeof THORCHAIN, actions: any[], notFinal: NotFinal[]) => new MidgardSource(protocol,
        {getActions: async () => actions} as any, {getTxStatus: async () => ({})} as any, {getTx: async () => ({})} as any, notFinal);

    test('lists every action whose status is not success, with whether it is exported', async () => {
        const notFinal: NotFinal[] = [];
        const bundles = await source(THORCHAIN, [
            action('swap', 'success', 'A'),
            action('refund', 'pending', 'B'),
            action('swap', 'pending', 'C', 'loanRepayment'),
        ], notFinal).bundlesFor('thor1wallet');

        expect(bundles.map(b => (b.data as any).in[0].txID)).toEqual(['A', 'C']);
        expect(notFinal.map(({key, exported}) => ({key, exported}))).toEqual([
            {key: 'midgard/refund.B', exported: false},
            {key: 'midgard/swap.C', exported: true},
        ]);
    });

    test('keys another protocol\'s actions by its Midgard', async () => {
        const notFinal: NotFinal[] = [];
        await source(MAYA, [action('refund', 'pending', 'D')], notFinal).bundlesFor('thor1wallet');

        expect(notFinal.map(item => item.key)).toEqual(['maya-midgard/refund.D']);
    });
});
