import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prune } from '../src/prune.ts'
import { writeSnapshot } from '../src/snapshot.ts'

const git = (dir: string, ...args: string[]) =>
    execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.hooksPath=/dev/null', ...args], { stdio: 'pipe' })

/** A git repo with the state dir in a sub folder: snapshots listing the given action ids, and those actions stored. */
function repo(snapshots: Record<string, string[]>): string {
    const root = mkdtempSync(join(tmpdir(), 'summ-sync-prune-'))
    git(root, 'init', '-q')
    git(root, 'commit', '-q', '--allow-empty', '-m', 'start')
    const state = join(root, 'summ')
    mkdirSync(join(state, 'actions'), { recursive: true })
    for (const [name, ids] of Object.entries(snapshots)) {
        writeSnapshot(join(state, 'snapshots', `${name}.json`), { takenAt: name, total: ids.length, actions: ids.map((id) => ({ id, txHash: '', category: '', tags: [] })) })
        for (const id of ids) writeFileSync(join(state, 'actions', `${id}.json`), '{}\n')
    }
    return state
}

test('prune removes old snapshots and the stored actions no kept snapshot lists, once committed', () => {
    const state = repo({ s1: ['a', 'b'], s2: ['b', 'c'], s3: ['c', 'd'] })
    assert.deepEqual(prune(state, 2).uncommitted.sort(), ['actions/a.json', 'snapshots/s1.json'])
    assert.ok(existsSync(join(state, 'actions', 'a.json')), 'nothing removed while uncommitted')
    git(state, 'add', '.')
    git(state, 'commit', '-q', '-m', 'state')
    writeFileSync(join(state, 'actions', 'a.json'), '{"changed": true}\n')
    assert.deepEqual(prune(state, 2).uncommitted, ['actions/a.json'], 'a changed file is not committed')
    git(state, 'checkout', '--', '.')
    assert.deepEqual(prune(state, 2), { removed: ['snapshots/s1.json', 'actions/a.json'], uncommitted: [] })
    assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => existsSync(join(state, 'actions', `${id}.json`))), [false, true, true, true])
    assert.equal(existsSync(join(state, 'snapshots', 's1.json')), false)
    assert.deepEqual(prune(state, 2), { removed: [], uncommitted: [] })
})
