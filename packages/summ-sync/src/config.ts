// <state dir>/summ-sync.json: the sync's settings (docs: README.md).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Config {
    /** Chains whose CSV files the user uploads; the sync manages their rows. */
    managedChains: string[]
    /** Summ's source names of the uploaded rows. */
    managedSources: string[]
    /** Rows before this date (YYYY-MM-DD) are in filed years. */
    filedBefore: string | null
}

export const DEFAULTS: Config = {
    managedChains: ['THOR', 'MAYA'],
    managedSources: [],
    filedBefore: null,
}

export function parseConfig(text: string): Config {
    const config: Config = { ...DEFAULTS, ...JSON.parse(text) }
    for (const key of ['managedChains', 'managedSources'] as const) {
        const value: unknown = config[key]
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
            throw new Error(`summ-sync.json: ${key} must be a list of strings`)
        }
    }
    if (config.filedBefore !== null && !/^\d{4}-\d{2}-\d{2}$/.test(config.filedBefore)) {
        throw new Error('summ-sync.json: filedBefore must be a date (YYYY-MM-DD) or null')
    }
    return config
}

export function loadConfig(stateDir: string): Config {
    const file = join(stateDir, 'summ-sync.json')
    return existsSync(file) ? parseConfig(readFileSync(file, 'utf8')) : { ...DEFAULTS }
}
