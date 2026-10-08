// <state dir>/summ-sync.json: the sync's settings (docs: README.md).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const DEFAULTS = {
    managedChains: ['THOR', 'MAYA'],
    managedSources: [],
    filedBefore: null,
}

export function parseConfig(text) {
    const config = { ...DEFAULTS, ...JSON.parse(text) }
    for (const key of ['managedChains', 'managedSources']) {
        if (!Array.isArray(config[key]) || !config[key].every((v) => typeof v === 'string')) {
            throw new Error(`summ-sync.json: ${key} must be a list of strings`)
        }
    }
    if (config.filedBefore !== null && !/^\d{4}-\d{2}-\d{2}$/.test(config.filedBefore)) {
        throw new Error('summ-sync.json: filedBefore must be a date (YYYY-MM-DD) or null')
    }
    return config
}

export function loadConfig(stateDir) {
    const file = join(stateDir, 'summ-sync.json')
    return existsSync(file) ? parseConfig(readFileSync(file, 'utf8')) : { ...DEFAULTS }
}
