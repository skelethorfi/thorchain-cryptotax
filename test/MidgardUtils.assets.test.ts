import {describe, expect, test} from '@jest/globals';
import {parseMidgardAsset} from '../src/cryptotax-thorchain/MidgardUtils';
import {MAYA} from '../src/protocols/Protocol';

describe('parseMidgardAsset names (docs/specs/assets.md)', () => {
    test.each([
        ['BTC.BTC', 'BTC', 'BTC', 'BTC'],
        ['ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'ETH', 'USDC', 'USDC'],
        ['THOR.RUNE', 'THOR', 'RUNE', 'RUNE'],
        ['BTC/BTC', 'THOR', 'ThorSynth.BTC.BTC', 'BTC/BTC'],
        ['ETH/THOR-0XA5F2211B9B8170F694421F2046281775E8468044', 'THOR', 'ThorSynth.ETH.THOR', 'ETH/THOR'],
        ['BTC~BTC', 'THOR', 'BTC', 'BTC~BTC'],
        ['BTC-BTC', 'THOR', 'BTC', 'BTC-BTC'],
        ['ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'THOR', 'USDC', 'ETH-USDC'],
        ['X/RUJI', 'THOR', 'RUJI', 'RUJI'],
    ])('%s', (asset, blockchain, currency, displayCurrency) => {
        expect(parseMidgardAsset(asset)).toEqual({blockchain, currency, displayCurrency});
    });

    test('Maya uses its own prefix and chain', () => {
        expect(parseMidgardAsset('BTC/BTC', MAYA)).toEqual({blockchain: 'MAYA', currency: 'MayaSynth.BTC.BTC', displayCurrency: 'BTC/BTC'});
    });
});
