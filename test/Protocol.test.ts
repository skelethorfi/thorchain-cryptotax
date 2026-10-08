import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {formatBlockchain, getProtocol, MAYA, THORCHAIN} from '../src/domain/Protocol.ts';

describe('Protocol', () => {
    test('THORChain amounts are all 1e8', () => {
        assert.equal(THORCHAIN.decimals('THOR.RUNE'), 8);
        assert.equal(THORCHAIN.decimals('BTC.BTC'), 8);
    });

    test('Maya: CACAO is 1e10, the MAYA token 1e4, other assets 1e8', () => {
        assert.equal(MAYA.decimals('MAYA.CACAO'), 10);
        assert.equal(MAYA.decimals('MAYA.MAYA'), 4);
        assert.equal(MAYA.decimals('MAYA'), 4);
        assert.equal(MAYA.decimals('THOR.RUNE'), 8);
        assert.equal(MAYA.decimals('KUJI.KUJI'), 8);
    });

    test('native chains get their blockchain name; others are unchanged', () => {
        assert.equal(formatBlockchain('THOR'), 'THORChain');
        assert.equal(formatBlockchain('MAYA'), 'Mayachain');
        assert.equal(formatBlockchain('BTC'), 'BTC');
    });

    test('Maya counterparty and default CACAO gas', () => {
        assert.equal(MAYA.counterparty, 'mayaprotocol');
        assert.equal(MAYA.defaultGas, '2000000000');
    });

    test('getProtocol defaults to THORChain and rejects unknown ids', () => {
        assert.equal(getProtocol(undefined), THORCHAIN);
        assert.equal(getProtocol('maya'), MAYA);
        assert.throws(() => getProtocol('cosmos'), /Unknown protocol: cosmos/);
    });
});
