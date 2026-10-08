import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {parseMidgardAsset} from '../src/sources/thorchain/MidgardUtils.ts';
import {MAYA, THORCHAIN, withAssetNames} from '../src/domain/Protocol.ts';

describe('parseMidgardAsset names (docs/specs/assets.md)', () => {
    for (const [asset, blockchain, currency, displayCurrency] of [
        ['BTC.BTC', 'BTC', 'BTC', 'BTC'],
        ['ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'ETH', 'USDC', 'USDC'],
        ['THOR.RUNE', 'THOR', 'RUNE', 'RUNE'],
        ['BTC/BTC', 'THOR', 'ThorSynth.BTC.BTC', 'BTC/BTC'],
        ['ETH/THOR-0XA5F2211B9B8170F694421F2046281775E8468044', 'THOR', 'ThorSynth.ETH.THOR', 'ETH/THOR'],
        ['BTC~BTC', 'THOR', 'BTC', 'BTC~BTC'],
        ['BTC-BTC', 'THOR', 'BTC', 'BTC-BTC'],
        ['ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', 'THOR', 'USDC', 'ETH-USDC'],
        ['X/RUJI', 'THOR', 'RUJI', 'RUJI'],
    ]) {
        test(`${asset}`, () => {
            assert.deepEqual(parseMidgardAsset(asset), {blockchain, currency, displayCurrency});
        });
    }

    test('Maya uses its own prefix and chain', () => {
        assert.deepEqual(parseMidgardAsset('BTC/BTC', MAYA), {blockchain: 'MAYA', currency: 'MayaSynth.BTC.BTC', displayCurrency: 'BTC/BTC'});
    });

    test('the config can prefix secured and trade assets', () => {
        const protocol = withAssetNames(THORCHAIN, {prefixSecuredAssets: true, prefixTradeAssets: true});

        assert.equal(parseMidgardAsset('ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', protocol).currency, 'ThorSecured.ETH.USDC');
        assert.equal(parseMidgardAsset('BTC~BTC', protocol).currency, 'ThorTrade.BTC.BTC');
        assert.equal(parseMidgardAsset('BTC/BTC', protocol).currency, 'ThorSynth.BTC.BTC');
        assert.equal(parseMidgardAsset('BTC.BTC', protocol).currency, 'BTC');
    });

    test('each option is independent, and Maya uses its own prefix', () => {
        const protocol = withAssetNames(MAYA, {prefixSecuredAssets: true});

        assert.equal(parseMidgardAsset('BTC-BTC', protocol).currency, 'MayaSecured.BTC.BTC');
        assert.equal(parseMidgardAsset('BTC~BTC', protocol).currency, 'BTC');
    });
});
