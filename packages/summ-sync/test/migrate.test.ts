import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from '../src/migrate.ts'
import { latestSnapshot, readSnapshot, readSnapshotFile } from '../src/snapshot.ts'

const detail = (id: string, quantity: string, moved = 0) => ({
    action: { _id: id, sortPriority: moved, outgoing: [{ _id: `leg-${id}`, id: `row-${id}`, quantity }] },
    history: ['1 Jan 2024 10:00 · import (original)', `_${moved} earlier versions not read._`],
})

/** An old snapshot folder: the listed ids (as actions.jsonl), the details given, and a manifest. */
function oldSnapshot(state: string, name: string, listed: string[], details: ReturnType<typeof detail>[]) {
    const dir = join(state, 'snapshots', name)
    mkdirSync(join(dir, 'details'), { recursive: true })
    writeFileSync(join(dir, 'actions.jsonl'), listed.map((id) => JSON.stringify({ tags: ['IGNORED'], 'Action ID': id, 'Tx Hash': `h${id}`, 'Action Category': 'send', Date: 'x' })).join('\n') + '\n')
    for (const d of details) writeFileSync(join(dir, 'details', `${d.action._id}.json`), JSON.stringify(d))
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ takenAt: `${name}Z`, total: listed.length, details: details.length }))
}

test('migrate writes each id once to the store and a snapshot file per old folder', () => {
    const state = mkdtempSync(join(tmpdir(), 'summ-sync-migrate-'))
    oldSnapshot(state, '2024-01-01T00-00-00', ['a1', 'a2', 'x'], [detail('a1', '1'), detail('a2', '2')])
    // a1 again with only fields the sync does not read moved; a2 with a different leg under the same id
    oldSnapshot(state, '2024-01-02T00-00-00', ['a1', 'a2', 'a3', 'x'], [detail('a1', '1', 5), detail('a2', '9'), detail('a3', '3')])
    mkdirSync(join(state, 'deleted', '2024-01-03T00-00-00'), { recursive: true })
    writeFileSync(join(state, 'deleted', '2024-01-03T00-00-00', 'a4.json'), JSON.stringify(detail('a4', '4')))

    const result = migrate(state)
    assert.deepEqual(result.snapshots, ['2024-01-01T00-00-00', '2024-01-02T00-00-00'])
    assert.equal(result.stored, 4)
    assert.deepEqual(result.differs, [{ id: 'a2', from: 'snapshots/2024-01-02T00-00-00' }])
    assert.deepEqual(readdirSync(join(state, 'actions')).sort(), ['a1.json', 'a2.json', 'a3.json', 'a4.json'])

    const file = latestSnapshot(state)
    const snapshot = readSnapshotFile(file)
    assert.deepEqual([snapshot.takenAt, snapshot.total], ['2024-01-02T00-00-00Z', 4])
    assert.deepEqual(snapshot.actions[3], { id: 'x', txHash: 'hx', category: 'send', tags: ['IGNORED'] })
    const read = readSnapshot(file)
    assert.deepEqual(read.legs.map((l) => l.actionId), ['a1', 'a2', 'a3'])
    assert.deepEqual([...read.txHashes].sort(), ['ha1', 'ha2', 'ha3', 'hx'])
    assert.deepEqual(migrate(state).skipped.length, 2, 'a second run changes nothing')
})
