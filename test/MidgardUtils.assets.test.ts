import {describe, expect, test} from '@jest/globals';
import {parseMidgardAsset} from '../src/sources/thorchain/MidgardUtils';
import {MAYA, THORCHAIN, withAssetNames} from '../src/domain/Protocol';

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

    test('the config can prefix secured and trade assets', () => {
        const protocol = withAssetNames(THORCHAIN, {prefixSecuredAssets: true, prefixTradeAssets: true});

        expect(parseMidgardAsset('ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', protocol).currency).toBe('ThorSecured.ETH.USDC');
        expect(parseMidgardAsset('BTC~BTC', protocol).currency).toBe('ThorTrade.BTC.BTC');
        expect(parseMidgardAsset('BTC/BTC', protocol).currency).toBe('ThorSynth.BTC.BTC');
        expect(parseMidgardAsset('BTC.BTC', protocol).currency).toBe('BTC');
    });

    test('each option is independent, and Maya uses its own prefix', () => {
        const protocol = withAssetNames(MAYA, {prefixSecuredAssets: true});

        expect(parseMidgardAsset('BTC-BTC', protocol).currency).toBe('MayaSecured.BTC.BTC');
        expect(parseMidgardAsset('BTC~BTC', protocol).currency).toBe('BTC');
    });
});
