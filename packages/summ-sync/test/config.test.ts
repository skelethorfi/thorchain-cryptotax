import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS, loadConfig, parseConfig } from '../src/config.ts'

test('a missing config gives the defaults', () => {
    assert.deepEqual(loadConfig(mkdtempSync(join(tmpdir(), 'summ-sync-'))), DEFAULTS)
})

test('a config overrides the defaults it names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'summ-sync-'))
    writeFileSync(join(dir, 'summ-sync.json'), JSON.stringify({ managedSources: ['thorchain'], filedBefore: '2024-01-01' }))
    assert.deepEqual(loadConfig(dir), { managedChains: ['THOR', 'MAYA'], managedSources: ['thorchain'], filedBefore: '2024-01-01', timezone: 'UTC', extraDirs: [] })
})

test('a config with wrong types is refused', () => {
    assert.throws(() => parseConfig('{"managedChains": "THOR"}'), /managedChains must be a list/)
    assert.throws(() => parseConfig('{"filedBefore": "July 2025"}'), /filedBefore must be a date/)
    assert.throws(() => parseConfig('{"timezone": "Mars/Base"}'), /timezone must be an IANA name/)
})
