// <state dir>/summ-sync.json: the sync's settings (docs: README.md).

import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export interface Config {
    /** Chains whose CSV files the user uploads; the sync manages their rows. */
    managedChains: string[]
    /** Summ's source names of the uploaded rows. */
    managedSources: string[]
    /** Rows before this date (YYYY-MM-DD) are in filed years. */
    filedBefore: string | null
    /** Summ's account timezone (IANA name): the days of the run's periods and of filedBefore. */
    timezone: string
    /** Folders (relative to the state dir) of hand-made period files, e.g. manual rows; read with the run. */
    extraDirs: string[]
}

export const DEFAULTS: Config = {
    managedChains: ['THOR', 'MAYA'],
    managedSources: [],
    filedBefore: null,
    timezone: 'UTC',
    extraDirs: [],
}

export function parseConfig(text: string): Config {
    const config: Config = { ...DEFAULTS, ...JSON.parse(text) }
    for (const key of ['managedChains', 'managedSources', 'extraDirs'] as const) {
        const value: unknown = config[key]
        if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
            throw new Error(`summ-sync.json: ${key} must be a list of strings`)
        }
    }
    if (config.filedBefore !== null && !/^\d{4}-\d{2}-\d{2}$/.test(config.filedBefore)) {
        throw new Error('summ-sync.json: filedBefore must be a date (YYYY-MM-DD) or null')
    }
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: config.timezone })
    } catch {
        throw new Error(`summ-sync.json: timezone must be an IANA name such as "Europe/London" (got ${JSON.stringify(config.timezone)})`)
    }
    return config
}

export function loadConfig(stateDir: string): Config {
    const file = join(stateDir, 'summ-sync.json')
    return existsSync(file) ? parseConfig(readFileSync(file, 'utf8')) : { ...DEFAULTS }
}

/** config.extraDirs as paths: each is relative to the state dir. */
export function extraDirsOf(stateDir: string, config: Config): string[] {
    return config.extraDirs.map((dir) => resolve(stateDir, dir))
}
