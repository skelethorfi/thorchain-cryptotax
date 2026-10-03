import {describe, expect, test} from "@jest/globals";
import {TaxConfig} from "../src/thorchain-exporter/TaxConfig";
import fs from "fs-extra";
import os from "os";
import path from "path";

describe('TaxConfig', () => {
    test('applyDefaults with empty config', () => {
        const result = TaxConfig.applyDefaults({});

        expect(result).toEqual({
            outputPath: 'output',
            unsupportedActionsPath: 'unsupported-actions',
            cachePath: 'cache',
            toDate: new Date().toISOString().substring(0, 10)
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
            cachePath: 'custom-cache',
            wallets: []
        };

        const result = TaxConfig.applyDefaults(config);

        expect(result).toEqual({
            fromDate: '2020-01-01',
            toDate: '2020-12-31',
            frequency: 'monthly',
            cacheDataSources: true,
            outputPath: 'custom-output',
            unsupportedActionsPath: 'custom-unsupported-actions',
            cachePath: 'custom-cache',
            wallets: []
        });
    });
});

describe('TaxConfig paths', () => {
    test('resolves relative paths against the config file folder', () => {
        const config = TaxConfig.resolvePaths(TaxConfig.applyDefaults({cachePath: 'FY/cache'}), '/private/tax');

        expect(config.outputPath).toBe(path.resolve('/private/tax/output'));
        expect(config.unsupportedActionsPath).toBe(path.resolve('/private/tax/unsupported-actions'));
        expect(config.cachePath).toBe(path.resolve('/private/tax/FY/cache'));
    });

    test('keeps absolute paths', () => {
        const config = TaxConfig.resolvePaths(TaxConfig.applyDefaults({outputPath: '/elsewhere/output'}), '/private/tax');

        expect(config.outputPath).toBe(path.resolve('/elsewhere/output'));
    });

    test('load resolves paths relative to the config file, not the working directory', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-config-'));
        const file = path.join(dir, 'config.toml');
        fs.writeFileSync(file, 'fromDate = "2024-07-01"\ncachePath = "FY/cache"\n');

        const config = TaxConfig.load(file);

        expect(config.cachePath).toBe(path.join(dir, 'FY/cache'));
        expect(config.outputPath).toBe(path.join(dir, 'output'));
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

        expect(TaxConfig.load(file).assets).toEqual({prefixSecuredAssets: true});
    });
});
