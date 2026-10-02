import {describe, expect, test} from '@jest/globals';
import {getInboundFee} from '../src/cryptotax-thorchain/ThorchainUtils';
import {MAYA} from '../src/protocols/Protocol';

const thornode = (id: string, asset: string, amount: string) => ({tx: {id, gas: [{asset, amount}]}} as any);

describe('getInboundFee (docs/specs/fees.md)', () => {
    test('prefers THORNode gas over any default', () => {
        expect(getInboundFee('tx1', [thornode('tx1', 'BTC.BTC', '5000')], 'BTC.BTC')).toEqual({feeCurrency: 'BTC', feeAmount: '0.00005'});
        expect(getInboundFee('tx1', [thornode('tx1', 'THOR.RUNE', '2000000')], 'THOR.RUNE')).toEqual({feeCurrency: 'RUNE', feeAmount: '0.02'});
    });

    test('any THORChain asset without THORNode data pays 0.02 RUNE', () => {
        for (const asset of ['THOR.RUNE', 'THOR.TCY', 'THOR.KUJI', 'BTC/BTC', 'BTC~BTC']) {
            expect(getInboundFee('tx', [], asset)).toEqual({feeCurrency: 'RUNE', feeAmount: '0.02'});
        }
    });

    test('L1 assets and tokens without THORNode data have no fee', () => {
        for (const asset of ['BTC.BTC', 'ETH.ETH', 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48']) {
            expect(getInboundFee('tx', [], asset)).toEqual({feeCurrency: '', feeAmount: ''});
        }
    });

    test('Maya: CACAO pays 0.2 CACAO, RUNE still pays 0.02 RUNE, synths get no RUNE fallback', () => {
        expect(getInboundFee('tx', [], 'MAYA.CACAO', MAYA)).toEqual({feeCurrency: 'CACAO', feeAmount: '0.2'});
        expect(getInboundFee('tx', [], 'THOR.RUNE', MAYA)).toEqual({feeCurrency: 'RUNE', feeAmount: '0.02'});
        expect(getInboundFee('tx', [], 'BTC/BTC', MAYA)).toEqual({feeCurrency: '', feeAmount: ''});
    });
});
