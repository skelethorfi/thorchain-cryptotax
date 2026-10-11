import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {interpret} from "../src/interpret/registry.ts";
import type {RawBundle} from "../src/sources/RawBundle.ts";
import {MAYA, THORCHAIN} from "../src/domain/Protocol.ts";
import {readCaseInput, toBundle} from "../src/fixtures/GoldenCase.ts";

const midgardBundle = (action: any, protocol = THORCHAIN): RawBundle =>
    ({source: 'midgard', protocol: protocol.id, wallet: '', data: action, thornodeTxs: [], cosmosTxs: []});

describe('interpret', () => {
    test('returns a failure with the action context instead of throwing', () => {
        const bundle = toBundle(readCaseInput('test/cases/switch/gaia-kuji'));

        // Make the asset string invalid
        (bundle.data as any).in[0].coins[0].asset = 'INVALID';

        assert.deepEqual(interpret(bundle, THORCHAIN), {activities: [], issues: [{
            kind: 'failed',
            message: '[Midgard] Failed to parse asset string: "INVALID". type: switch, txid: 0000000000000000000000000000000000000000000000000000000000000000',
        }]});
    });

    test('an action type with no interpreter is unsupported', () => {
        const action = {type: 'donate', date: '0', in: [], out: [], metadata: {}};

        assert.deepEqual(interpret(midgardBundle(action), THORCHAIN).issues, [{kind: 'unsupported', message: 'unsupported action: donate'}]);
    });

    test('a contract type with no interpreter is unsupported', () => {
        const action = {type: 'contract', date: '0', in: [], out: [], metadata: {contract: {contractType: 'wasm-unknown/call'}}};

        assert.deepEqual(interpret(midgardBundle(action), THORCHAIN).issues, [{kind: 'unsupported', message: 'unsupported action: contract wasm-unknown/call'}]);
    });

    test('only some action types are mapped on Maya', () => {
        const action = {type: 'bond', date: '0', in: [], out: [], metadata: {}};

        assert.deepEqual(interpret(midgardBundle(action, MAYA), MAYA).issues, [{kind: 'unsupported', message: 'unsupported action: bond'}]);
    });

    test('a Levana position is to be entered by hand', () => {
        const bundle = toBundle(readCaseInput('test/cases/rujira/levana-open-position'));

        assert.deepEqual(interpret(bundle, THORCHAIN).issues.map(issue => issue.kind), ['manual']);
    });

    test('an LP add with no deposit address gives a warning', () => {
        const bundle = toBundle(readCaseInput('test/cases/liquidity/add-btc-rune-symmetric'));
        (bundle.data as any).in[0].address = '';

        const {activities, issues} = interpret(bundle, THORCHAIN);
        assert.deepEqual(issues, [{kind: 'warning', message: 'missing deposit address'}]);
        assert.equal(activities.length, 1);
    });

    test('a synth swap from an L1 address (a savers withdrawal) is ignored', () => {
        const action = {
            type: 'swap', status: 'success', date: '1680350400000000000', height: '1',
            in: [{address: 'bc1qexample', coins: [{asset: 'BTC/BTC', amount: '100000000'}], txID: 'A'.repeat(64)}],
            out: [{address: 'bc1qexample', coins: [{asset: 'BTC.BTC', amount: '99000000'}], txID: 'B'.repeat(64)}],
            metadata: {swap: {memo: '=:BTC.BTC:bc1qexample', networkFees: [], affiliateAddress: '', affiliateFee: '0', isStreamingSwap: false, txType: 'swap'}},
        };

        assert.deepEqual(interpret(midgardBundle(action), THORCHAIN), {activities: [], issues: [{
            kind: 'ignored',
            message: 'synth swap from an L1 address (a savers withdrawal)',
        }]});
    });

    test('Midgard sends are ignored on every protocol', () => {
        const action = {type: 'send', date: '0', in: [], out: [], metadata: {}};

        for (const protocol of [THORCHAIN, MAYA]) {
            assert.deepEqual(interpret(midgardBundle(action, protocol), protocol).issues.map(issue => issue.kind), ['ignored']);
        }
    });
});
