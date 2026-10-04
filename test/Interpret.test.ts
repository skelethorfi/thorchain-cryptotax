import {describe, expect, test} from "@jest/globals";
import fs from "fs-extra";
import {interpret} from "../src/interpret/registry";
import {RawBundle} from "../src/sources/RawBundle";
import {MAYA, THORCHAIN} from "../src/protocols/Protocol";

const midgardBundle = (action: any, protocol = THORCHAIN): RawBundle =>
    ({source: 'midgard', protocol: protocol.id, wallet: '', data: action, thornodeTxs: [], cosmosTxs: []});

describe('interpret', () => {
    test('returns a failure with the action context instead of throwing', () => {
        const action = fs.readJSONSync('test/testdata/Switch_KUJI.json');

        // Make the asset string invalid
        action.in[0].coins[0].asset = 'INVALID';

        expect(interpret(midgardBundle(action), THORCHAIN)).toStrictEqual({rows: [], issues: [{
            kind: 'failed',
            message: '[Midgard] Failed to parse asset string: "INVALID". type: switch, txid: 0000000000000000000000000000000000000000000000000000000000000000',
        }]});
    });

    test('an action type with no interpreter is unsupported', () => {
        const action = {type: 'donate', date: '0', in: [], out: [], metadata: {}};

        expect(interpret(midgardBundle(action), THORCHAIN).issues).toStrictEqual([{kind: 'unsupported', message: 'unsupported action: donate'}]);
    });

    test('a contract type with no interpreter is unsupported', () => {
        const action = {type: 'contract', date: '0', in: [], out: [], metadata: {contract: {contractType: 'wasm-unknown/call'}}};

        expect(interpret(midgardBundle(action), THORCHAIN).issues).toStrictEqual([{kind: 'unsupported', message: 'unsupported action: contract wasm-unknown/call'}]);
    });

    test('only some action types are mapped on Maya', () => {
        const action = {type: 'bond', date: '0', in: [], out: [], metadata: {}};

        expect(interpret(midgardBundle(action, MAYA), MAYA).issues).toStrictEqual([{kind: 'unsupported', message: 'unsupported action: bond'}]);
    });

    test('Midgard sends are ignored on every protocol', () => {
        const action = {type: 'send', date: '0', in: [], out: [], metadata: {}};

        for (const protocol of [THORCHAIN, MAYA]) {
            expect(interpret(midgardBundle(action, protocol), protocol).issues.map(issue => issue.kind)).toStrictEqual(['ignored']);
        }
    });
});
