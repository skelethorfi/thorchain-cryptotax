import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {type NotFinal, pendingAge} from '../src/sources/Pending.ts';
import {MidgardSource} from '../src/sources/Source.ts';
import {MAYA, THORCHAIN} from '../src/domain/Protocol.ts';

const DAY = 86400_000;

describe('pendingAge', () => {
    const today = new Date(Date.UTC(2026, 6, 31));
    const daysAgo = (days: number) => new Date(today.getTime() - days * DAY);

    test('recent within the grace period, stuck from the cut-off, waiting in between', () => {
        assert.equal(pendingAge(daysAgo(2.9), today, 3, 30), 'recent');
        assert.equal(pendingAge(daysAgo(3), today, 3, 30), 'waiting');
        assert.equal(pendingAge(daysAgo(29.9), today, 3, 30), 'waiting');
        assert.equal(pendingAge(daysAgo(30), today, 3, 30), 'stuck');
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
    const source = (protocol: typeof THORCHAIN, actions: any[], notFinal: NotFinal[], stuckBefore?: Date) => new MidgardSource(protocol,
        {getActions: async () => actions} as any, {getTxStatus: async () => ({})} as any, {getTx: async () => ({})} as any, notFinal, stuckBefore);
    const exported = (notFinal: NotFinal[]) => notFinal.map(({key, exported, coveredBy}) => ({key, exported, coveredBy}));

    test('lists every action whose status is not success, with whether it is exported', async () => {
        const notFinal: NotFinal[] = [];
        const bundles = await source(THORCHAIN, [
            action('swap', 'success', 'A'),
            action('refund', 'pending', 'B'),
            action('swap', 'pending', 'C', 'loanRepayment'),
        ], notFinal).bundlesFor('thor1wallet');

        assert.deepEqual(bundles.map(b => (b.data as any).in[0].txID), ['A', 'C']);
        assert.deepEqual(notFinal.map(({key, exported}) => ({key, exported})), [
            {key: 'midgard/refund.B', exported: false},
            {key: 'midgard/swap.C', exported: true},
        ]);
    });

    test('keys another protocol\'s actions by its Midgard', async () => {
        const notFinal: NotFinal[] = [];
        await source(MAYA, [action('refund', 'pending', 'D')], notFinal).bundlesFor('thor1wallet');

        assert.deepEqual(notFinal.map(item => item.key), ['maya-midgard/refund.D']);
    });

    test('a stuck refund is exported; a recent one is not', async () => {
        const stuck: NotFinal[] = [];
        const recent: NotFinal[] = [];
        const refund = action('refund', 'pending', 'E');
        const afterIt = new Date(date.getTime() + DAY);

        assert.equal((await source(THORCHAIN, [refund], stuck, afterIt).bundlesFor('thor1wallet')).length, 1);
        assert.equal((await source(THORCHAIN, [refund], recent, date).bundlesFor('thor1wallet')).length, 0);
        assert.equal((await source(THORCHAIN, [refund], [], undefined).bundlesFor('thor1wallet')).length, 0);
        assert.deepEqual(exported(stuck), [{key: 'midgard/refund.E', exported: true, coveredBy: undefined}]);
    });

    test('an action covered by a successful one of the same txid is not exported, e.g. a savers deposit\'s swap', async () => {
        const notFinal: NotFinal[] = [];
        const afterIt = new Date(date.getTime() + DAY);
        const bundles = await source(THORCHAIN, [
            action('addLiquidity', 'success', 'F'),
            action('swap', 'pending', 'F', 'add'),
            action('swap', 'success', 'G'),
            action('refund', 'pending', 'G'),
        ], notFinal, afterIt).bundlesFor('thor1wallet');

        assert.deepEqual(bundles.map(b => (b.data as any).type), ['addLiquidity', 'swap']);
        assert.deepEqual(exported(notFinal), [
            {key: 'midgard/swap.F', exported: false, coveredBy: 'midgard/addLiquidity.F'},
            {key: 'midgard/refund.G', exported: false, coveredBy: 'midgard/swap.G'},
        ]);
    });

    test('a send of the same txid does not cover a stuck refund: it is how the wallet paid', async () => {
        const notFinal: NotFinal[] = [];
        await source(MAYA, [action('send', 'success', 'H'), action('refund', 'pending', 'H')], notFinal, new Date(date.getTime() + DAY))
            .bundlesFor('thor1wallet');

        assert.deepEqual(exported(notFinal), [{key: 'maya-midgard/refund.H', exported: true, coveredBy: undefined}]);
    });
});
