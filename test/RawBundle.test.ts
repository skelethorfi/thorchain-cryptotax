import {describe, expect, test} from "@jest/globals";
import {attachAuctionDeposits, dedupeBundles, getBundleKey, RawBundle, selectSends} from "../src/sources/RawBundle";
import {ProtocolId} from "../src/domain/Protocol";

const action = (txID: string, type = 'swap') => ({type, date: '1680350400000000000', in: [{address: 'thor1a', coins: [], txID}], out: [], pools: [], metadata: {}});

const bundle = (source: RawBundle['source'], wallet: string, data: any, protocol: ProtocolId = 'thorchain'): RawBundle =>
    ({source, protocol, wallet, data, thornodeTxs: [], cosmosTxs: []});

describe('getBundleKey', () => {
    test('is the store record a bundle was listed as', () => {
        expect(getBundleKey(bundle('midgard', 'thor1a', action('A')))).toBe('midgard/swap.A');
        expect(getBundleKey(bundle('midgard', 'thor1a', action('A'), 'maya'))).toBe('maya-midgard/swap.A');
        expect(getBundleKey(bundle('viewblock', 'thor1a', {hash: 'H'}))).toBe('viewblock/H');
        expect(getBundleKey(bundle('tcy', 'thor1a', {date: '1700000000'}))).toBe('tcy/thor1a.1700000000');
    });
});

describe('dedupeBundles', () => {
    test('keeps a Midgard action listed for two wallets once, from the first wallet', () => {
        const first = bundle('midgard', 'thor1a', action('A'));
        const second = bundle('midgard', 'thor1b', action('A'));
        const other = bundle('midgard', 'thor1b', action('B'));

        expect(dedupeBundles([first, second, other])).toStrictEqual({bundles: [first, other], duplicates: 1});
    });

    test('keeps the same txid on different protocols', () => {
        const bundles = [bundle('midgard', 'thor1a', action('A')), bundle('midgard', 'thor1a', action('A'), 'maya')];

        expect(dedupeBundles(bundles).duplicates).toBe(0);
    });

    test("keeps every wallet's Viewblock send, which maps from that wallet's side", () => {
        const bundles = [bundle('viewblock', 'thor1a', {hash: 'H'}), bundle('viewblock', 'thor1b', {hash: 'H'})];

        expect(dedupeBundles(bundles)).toStrictEqual({bundles, duplicates: 0});
    });
});

describe('selectSends', () => {
    const vbSend = (hash: string, date: string, types = ['network', 'send', 'main']) => ({hash, timestamp: Date.parse(date), types});

    test("keeps every wallet's Midgard send, which maps from that wallet's side", () => {
        const bundles = [bundle('midgard', 'thor1a', action('S', 'send')), bundle('midgard', 'thor1b', action('S', 'send'))];

        expect(dedupeBundles(bundles)).toStrictEqual({bundles, duplicates: 0});
    });

    test("drops a Midgard send that is another action's inbound, case ignored", () => {
        const swap = bundle('midgard', 'thor1a', action('ab', 'swap'));
        const inbound = bundle('midgard', 'thor1a', action('AB', 'send'));
        const plain = bundle('midgard', 'thor1a', action('CD', 'send'));

        expect(selectSends([swap, inbound, plain])).toStrictEqual({bundles: [swap, plain], dropped: {inbound: 1, outbound: 0, viewblock: 0}});
    });

    test("drops a THORChain send that is a Maya action's inbound (RUNE sent to a Maya vault)", () => {
        const mayaSwap = bundle('midgard', 'thor1a', action('AB', 'swap'), 'maya');
        const send = bundle('midgard', 'thor1a', action('AB', 'send'));

        expect(selectSends([mayaSwap, send])).toStrictEqual({bundles: [mayaSwap], dropped: {inbound: 1, outbound: 0, viewblock: 0}});
    });

    test('keeps only Viewblock sends from before 2022-04 that Midgard does not list', () => {
        const early = bundle('viewblock', 'thor1a', vbSend('E1', '2022-03-31T23:59:59Z'));
        const listed = bundle('viewblock', 'thor1a', vbSend('e2', '2021-07-01T00:00:00Z'));
        const late = bundle('viewblock', 'thor1a', vbSend('L1', '2022-04-01T00:00:00Z'));
        const swap = bundle('viewblock', 'thor1a', vbSend('W1', '2021-07-01T00:00:00Z', ['swap', 'main']));
        const midgard = bundle('midgard', 'thor1a', action('E2', 'send'));

        expect(selectSends([early, listed, late, swap, midgard])).toStrictEqual({bundles: [early, midgard], dropped: {inbound: 0, outbound: 0, viewblock: 3}});
    });

    test("drops a THORChain send that is a Maya action's outbound, by txid", () => {
        const swap = bundle('midgard', 'thor1a', {...action('IN'), out: [{address: 'thor1a', txID: 'OUTTX', coins: []}]}, 'maya');
        const payout = bundle('midgard', 'thor1a', action('outtx', 'send'));

        expect(selectSends([swap, payout])).toStrictEqual({bundles: [swap], dropped: {inbound: 0, outbound: 1, viewblock: 0}});
    });

    test('a send whose memo names a pending refund is its outbound: the refund is paid by it', () => {
        const txid = 'ab'.repeat(32);
        const refund = bundle('midgard', 'thor1a', {...action(txid, 'refund'), status: 'pending'}, 'maya');
        const coins = [{asset: 'THOR.RUNE', amount: '9998000000'}];
        const payout = bundle('midgard', 'thor1a', {...action('PAYOUT', 'send'), metadata: {send: {memo: `REFUND:${txid.toUpperCase()}`}},
            out: [{address: 'thor1a', txID: '', coins}]});

        const {bundles, dropped} = selectSends([refund, payout]);

        expect(dropped.outbound).toBe(1);
        expect(bundles).toHaveLength(1);
        expect(bundles[0].data).toMatchObject({type: 'refund', status: 'success', out: [{address: 'thor1a', txID: 'PAYOUT', coins}]});
    });

    test('a REFUND memo naming no listed action leaves the send a send', () => {
        const payout = bundle('midgard', 'thor1a', {...action('PAYOUT', 'send'), metadata: {send: {memo: `REFUND:${'cd'.repeat(32)}`}}});

        expect(selectSends([payout]).bundles).toEqual([payout]);
    });
});

describe('attachAuctionDeposits', () => {
    const MAYA = 'maya1-member';
    const THOR = 'thor1-member';
    const add = {type: 'addLiquidity', status: 'success', date: '2000', pools: ['THOR.RUNE'],
        in: [{address: MAYA, txID: 'DONATE', coins: [{asset: 'MAYA.CACAO', amount: '1'}]}, {address: THOR, txID: '', coins: [{asset: 'THOR.RUNE', amount: '1'}]}],
        out: [], metadata: {addLiquidity: {memo: 'donate:thor.rune', liquidityUnits: '1'}}};
    const send = (txID: string, memo: string, date = '1000', from = THOR) => bundle('midgard', THOR,
        {type: 'send', status: 'success', date, in: [{address: from, txID, coins: [{asset: 'THOR.RUNE', amount: '1'}]}], out: [], pools: [], metadata: {send: {memo}}});

    test("attaches the member's deposits to its donate add, and drops them as sends", () => {
        const auctionAdd = bundle('midgard', MAYA, add, 'maya');
        const deposit = send('D1', `+:THOR.RUNE:${MAYA.toUpperCase()}:wr:100:TIER1`);
        const other = send('S1', 'some memo');

        const {bundles, attached} = attachAuctionDeposits([auctionAdd, deposit, other]);

        expect(attached).toBe(1);
        expect(bundles).toEqual([{...auctionAdd, inbounds: [deposit.data]}, other]);
    });

    test('leaves a deposit after the add, from another address or to another member', () => {
        const auctionAdd = bundle('midgard', MAYA, add, 'maya');
        const sends = [send('D1', `+:THOR.RUNE:${MAYA}`, '3000'), send('D2', `+:THOR.RUNE:${MAYA}`, '1000', 'thor1-other'), send('D3', '+:THOR.RUNE:maya1-other')];

        expect(attachAuctionDeposits([auctionAdd, ...sends])).toEqual({bundles: [auctionAdd, ...sends], attached: 0});
    });
});
