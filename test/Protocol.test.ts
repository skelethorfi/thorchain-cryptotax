import {describe, expect, test} from '@jest/globals';
import {formatBlockchain, getProtocol, MAYA, THORCHAIN} from '../src/protocols/Protocol';

describe('Protocol', () => {
    test('THORChain amounts are all 1e8', () => {
        expect(THORCHAIN.decimals('THOR.RUNE')).toBe(8);
        expect(THORCHAIN.decimals('BTC.BTC')).toBe(8);
    });

    test('Maya: CACAO is 1e10, the MAYA token 1e4, other assets 1e8', () => {
        expect(MAYA.decimals('MAYA.CACAO')).toBe(10);
        expect(MAYA.decimals('MAYA.MAYA')).toBe(4);
        expect(MAYA.decimals('MAYA')).toBe(4);
        expect(MAYA.decimals('THOR.RUNE')).toBe(8);
        expect(MAYA.decimals('KUJI.KUJI')).toBe(8);
    });

    test('native chains get their blockchain name; others are unchanged', () => {
        expect(formatBlockchain('THOR')).toBe('THORChain');
        expect(formatBlockchain('MAYA')).toBe('MayaProtocol');
        expect(formatBlockchain('BTC')).toBe('BTC');
    });

    test('Maya counterparty and default CACAO gas', () => {
        expect(MAYA.counterparty).toBe('mayaprotocol');
        expect(MAYA.defaultGas).toBe('2000000000');
    });

    test('getProtocol defaults to THORChain and rejects unknown ids', () => {
        expect(getProtocol(undefined)).toBe(THORCHAIN);
        expect(getProtocol('maya')).toBe(MAYA);
        expect(() => getProtocol('cosmos')).toThrow('Unknown protocol: cosmos');
    });
});
