import {describe, expect, jest, test} from "@jest/globals";
import {TaxConfig} from "../src/config/TaxConfig";
import fs from "fs-extra";
import os from "os";
import path from "path";

describe('TaxConfig', () => {
    test('applyDefaults with empty config', () => {
        const result = TaxConfig.applyDefaults({}, new Date('2026-06-30T23:30:00.000Z'));

        expect(result).toEqual({
            outputPath: 'output',
            unsupportedActionsPath: 'unsupported-actions',
            storePath: 'store',
            toDate: '2026-06-30'
        });
    });

    test('applyDefaults with populated config', () => {
        const config = {
            fromDate: '2020-01-01',
            toDate: '2020-12-31',
            frequency: 'monthly' as const,
            cacheDataSources: true,
            outputPath: 'custom-output',
            unsupportedActionsPath: 'custom-unsupported-actions',
            storePath: 'custom-store',
            wallets: []
        };

        const result = TaxConfig.applyDefaults(config, new Date());

        expect(result).toEqual({
            fromDate: '2020-01-01',
            toDate: '2020-12-31',
            frequency: 'monthly',
            cacheDataSources: true,
            outputPath: 'custom-output',
            unsupportedActionsPath: 'custom-unsupported-actions',
            storePath: 'custom-store',
            wallets: []
        });
    });
});

describe('TaxConfig paths', () => {
    test('resolves relative paths against the config file folder', () => {
        const config = TaxConfig.resolvePaths(TaxConfig.applyDefaults({storePath: 'FY/store'}, new Date()), '/private/tax');

        expect(config.outputPath).toBe(path.resolve('/private/tax/output'));
        expect(config.unsupportedActionsPath).toBe(path.resolve('/private/tax/unsupported-actions'));
        expect(config.storePath).toBe(path.resolve('/private/tax/FY/store'));
    });

    test('keeps absolute paths', () => {
        const config = TaxConfig.resolvePaths(TaxConfig.applyDefaults({outputPath: '/elsewhere/output'}, new Date()), '/private/tax');

        expect(config.outputPath).toBe(path.resolve('/elsewhere/output'));
    });

    test('load resolves paths relative to the config file, not the working directory', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-config-'));
        const file = path.join(dir, 'config.toml');
        fs.writeFileSync(file, 'fromDate = "2024-07-01"\ncachePath = "FY/cache"\n');

        const config = TaxConfig.load(file, new Date());

        expect(config.storePath).toBe(path.join(dir, 'FY/cache'));
        expect(config.outputPath).toBe(path.join(dir, 'output'));
    });

    test('an old config with cachePath still works, as storePath', () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        expect(TaxConfig.renameDeprecated({cachePath: 'FY/cache'})).toEqual({storePath: 'FY/cache'});
        expect(() => TaxConfig.renameDeprecated({cachePath: 'a', storePath: 'b'})).toThrow(/both storePath and/);
    });

    test('loads the optional [assets] table from TOML', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tct-config-'));
        const file = path.join(dir, 'config.toml');
        fs.writeFileSync(file, [
            'fromDate = "2025-07-01"',
            'toDate = "2026-06-30"',
            'frequency = "yearly"',
            'cacheDataSources = true',
            'wallets = []',
            '',
            '[assets]',
            'prefixSecuredAssets = true',
        ].join('\n'));

        expect(TaxConfig.load(file, new Date()).assets).toEqual({prefixSecuredAssets: true});
    });
});
