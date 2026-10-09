import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionsWithTxids, periodsFilter } from '../src/pull.ts'
import { checkCovers, type Snapshot } from '../src/snapshot.ts'

test('actionsWithTxids finds listed actions by tx hash, in any case and with or without 0x', () => {
    const txid = 'ab'.repeat(32)
    const actions = [
        { tags: [], 'Action ID': 'a1', 'Tx Hash': `0x${txid.toUpperCase()}` },
        { tags: [], 'Action ID': 'a2', 'Tx Hash': 'cd'.repeat(32) },
        { tags: [], 'Action ID': 'a3' },
        { tags: [], 'Action ID': 'a4', 'Tx Hash': `${txid}__2` },
        { tags: [], 'Action ID': 'a5', 'Tx Hash': `${txid}-0` },
    ]
    assert.deepEqual(actionsWithTxids(actions, new Set([txid])), ['a1', 'a4', 'a5'])
})

test('periodsFilter selects each period with a day either side, in the timezone', () => {
    const f = periodsFilter([{ from: '2023-07-01', to: '2024-06-30' }], 'UTC') as { type: string; rules: { rules: { type: string; value: number }[] }[] }
    assert.equal(f.type, 'or')
    const [after, before] = f.rules[0].rules
    assert.deepEqual([after.type, new Date(after.value).toISOString()], ['after', '2023-06-30T00:00:00.000Z'])
    assert.deepEqual([before.type, new Date(before.value).toISOString()], ['before', '2024-07-02T00:00:00.000Z'])
    const tz = periodsFilter([{ from: '2023-07-01', to: '2024-06-30' }], 'Asia/Tokyo') as typeof f
    assert.equal(new Date(tz.rules[0].rules[0].value).toISOString(), '2023-06-29T15:00:00.000Z')
})

test('a plan needs a snapshot with managed detail for every period of the run', () => {
    const snap = (detailPeriods: Snapshot['detailPeriods']): Snapshot => ({ name: 's', legs: [], history: new Map(), txHashes: new Set(), detailPeriods })
    const year = { from: '2023-07-01', to: '2024-06-30' }
    assert.doesNotThrow(() => checkCovers(snap(null), [year]))
    assert.doesNotThrow(() => checkCovers(snap([year]), [year]))
    assert.throws(() => checkCovers(snap([year]), [year, { from: '2022-07-01', to: '2023-06-30' }]), /not 2022-07-01 to 2023-06-30: pull with this run dir/)
})
