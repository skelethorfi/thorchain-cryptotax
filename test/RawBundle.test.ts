import {describe, expect, test} from "@jest/globals";
import {dedupeBundles, getBundleKey, RawBundle, selectSends} from "../src/sources/RawBundle";
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

        expect(selectSends([swap, inbound, plain])).toStrictEqual({bundles: [swap, plain], dropped: {inbound: 1, viewblock: 0}});
    });

    test('a Maya action with the same txid does not drop a THORChain send', () => {
        const send = bundle('midgard', 'thor1a', action('AB', 'send'));

        expect(selectSends([bundle('midgard', 'thor1a', action('AB', 'swap'), 'maya'), send]).bundles).toContain(send);
    });

    test('keeps only Viewblock sends from before 2022-04 that Midgard does not list', () => {
        const early = bundle('viewblock', 'thor1a', vbSend('E1', '2022-03-31T23:59:59Z'));
        const listed = bundle('viewblock', 'thor1a', vbSend('e2', '2021-07-01T00:00:00Z'));
        const late = bundle('viewblock', 'thor1a', vbSend('L1', '2022-04-01T00:00:00Z'));
        const swap = bundle('viewblock', 'thor1a', vbSend('W1', '2021-07-01T00:00:00Z', ['swap', 'main']));
        const midgard = bundle('midgard', 'thor1a', action('E2', 'send'));

        expect(selectSends([early, listed, late, swap, midgard])).toStrictEqual({bundles: [early, midgard], dropped: {inbound: 0, viewblock: 3}});
    });
});
