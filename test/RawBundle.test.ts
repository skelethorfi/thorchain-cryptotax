import {describe, expect, test} from "@jest/globals";
import {dedupeBundles, getBundleKey, RawBundle} from "../src/sources/RawBundle";
import {ProtocolId} from "../src/domain/Protocol";

const action = (txID: string) => ({type: 'swap', date: '1680350400000000000', in: [{address: 'thor1a', coins: [], txID}], out: [], pools: [], metadata: {}});

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
