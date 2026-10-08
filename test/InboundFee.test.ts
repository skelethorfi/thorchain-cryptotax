import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {getInboundFee} from '../src/export/summ/ThorchainUtils.ts';
import {MAYA} from '../src/domain/Protocol.ts';

const thornode = (id: string, asset: string, amount: string) => ({tx: {id, gas: [{asset, amount}]}} as any);

describe('getInboundFee (docs/specs/fees.md)', () => {
    test('prefers THORNode gas over any default', () => {
        assert.deepEqual(getInboundFee('tx1', [thornode('tx1', 'BTC.BTC', '5000')], 'BTC.BTC'), {feeCurrency: 'BTC', feeAmount: '0.00005'});
        assert.deepEqual(getInboundFee('tx1', [thornode('tx1', 'THOR.RUNE', '2000000')], 'THOR.RUNE'), {feeCurrency: 'RUNE', feeAmount: '0.02'});
    });

    test('any THORChain asset without THORNode data pays 0.02 RUNE', () => {
        for (const asset of ['THOR.RUNE', 'THOR.TCY', 'THOR.KUJI', 'BTC/BTC', 'BTC~BTC']) {
            assert.deepEqual(getInboundFee('tx', [], asset), {feeCurrency: 'RUNE', feeAmount: '0.02'});
        }
    });

    test('L1 assets and tokens without THORNode data have no fee', () => {
        for (const asset of ['BTC.BTC', 'ETH.ETH', 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48']) {
            assert.deepEqual(getInboundFee('tx', [], asset), {feeCurrency: '', feeAmount: ''});
        }
    });

    test('Maya: CACAO pays 0.2 CACAO, RUNE still pays 0.02 RUNE, synths get no RUNE fallback', () => {
        assert.deepEqual(getInboundFee('tx', [], 'MAYA.CACAO', MAYA), {feeCurrency: 'CACAO', feeAmount: '0.2'});
        assert.deepEqual(getInboundFee('tx', [], 'THOR.RUNE', MAYA), {feeCurrency: 'RUNE', feeAmount: '0.02'});
        assert.deepEqual(getInboundFee('tx', [], 'BTC/BTC', MAYA), {feeCurrency: '', feeAmount: ''});
    });
});
