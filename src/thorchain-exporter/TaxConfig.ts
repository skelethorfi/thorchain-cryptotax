import {ITaxConfig} from "./ITaxConfig";
import path from "path";
import fs from "fs-extra";
import toml from "js-toml";

export class TaxConfig {
    // today: the default toDate (its UTC date)
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
            unsupportedActionsPath: path.resolve(baseDir, config.unsupportedActionsPath),
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
        const dateToday = today.toISOString().substring(0, 10);
        const defaults = {
            outputPath: 'output',
            unsupportedActionsPath: 'unsupported-actions',
            // The record store (docs/specs/snapshots.md); can be shared by several configs
            storePath: 'store',
            toDate: dateToday
        };

        return {
            ...defaults,
            ...config
        } as ITaxConfig;
    }
}
