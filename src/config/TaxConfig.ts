import {ITaxConfig, MAYA_LIQUIDITY_AUCTION} from "./ITaxConfig";
import path from "path";
import fs from "fs-extra";
import toml from "js-toml";
import {checkTimeZone, dateIn} from "../utils/DateRange";

export class TaxConfig {
    // today: the default toDate (its date in the config's timezone)
    static load(filename: string, today: Date): ITaxConfig {
        const config = this.renameDeprecated(this.loadConfigFile(filename));
        return this.resolvePaths(this.applyDefaults(config, today), path.dirname(path.resolve(filename)));
    }

    // Relative paths in the config are relative to the config file's folder, so a config
    // kept outside the repo also keeps its output and cache outside the repo.
    static resolvePaths(config: ITaxConfig, baseDir: string): ITaxConfig {
        return {
            ...config,
            outputPath: path.resolve(baseDir, config.outputPath),
            storePath: path.resolve(baseDir, config.storePath),
        };
    }

    // Old configs keep working: cachePath is now storePath
    static renameDeprecated(config: Partial<ITaxConfig>): Partial<ITaxConfig> {
        if (config.cachePath === undefined) {
            return config;
        }

        if (config.storePath !== undefined) {
            throw new Error('Config has both storePath and its old name cachePath: keep storePath');
        }

        console.warn('Config: cachePath is now called storePath (cachePath still works)');
        const {cachePath, ...rest} = config;
        return {...rest, storePath: cachePath};
    }

    private static loadConfigFile(filename: string): ITaxConfig {
        console.log(`Wallets config file: ${filename}\n`);

        const fileExtension = path.extname(filename).toLowerCase();
        const fileContent = fs.readFileSync(filename).toString();

        let config;

        if (fileExtension === '.toml') {
            config = toml.load(fileContent) as ITaxConfig;
        } else if (fileExtension === '.json') {
            config = JSON.parse(fileContent);
        } else {
            throw new Error(`Unsupported config file format: ${fileExtension}`);
        }

        return config;
    }

    static applyDefaults(config: Partial<ITaxConfig>, today: Date): ITaxConfig {
        if (config.timezone !== undefined) {
            checkTimeZone(config.timezone);
        }
        if (config.mayaLiquidityAuction !== undefined && !MAYA_LIQUIDITY_AUCTION.includes(config.mayaLiquidityAuction)) {
            throw new Error(`Config: mayaLiquidityAuction must be ${MAYA_LIQUIDITY_AUCTION.map(value => `"${value}"`).join(' or ')} (got ${JSON.stringify(config.mayaLiquidityAuction)})`);
        }

        if (config.incomeFrom !== undefined && !(Array.isArray(config.incomeFrom) && config.incomeFrom.every(address => typeof address === 'string' && address.length > 0))) {
            throw new Error(`Config: incomeFrom must be a list of addresses (got ${JSON.stringify(config.incomeFrom)})`);
        }

        for (const key of ['pendingStuckDays', 'pendingGraceDays'] as const) {
            const days = config[key];

            if (days !== undefined && !(typeof days === 'number' && days >= 0)) {
                throw new Error(`Config: ${key} must be a number of days, 0 or more (got ${JSON.stringify(days)})`);
            }
        }

        const dateToday = dateIn(today, config.timezone);
        const defaults = {
            outputPath: 'output',
            // The record store (docs/specs/snapshots.md); can be shared by several configs
            storePath: 'store',
            pendingStuckDays: 30,
            pendingGraceDays: 3,
            toDate: dateToday
        };

        return {
            ...defaults,
            ...config
        } as ITaxConfig;
    }
}
