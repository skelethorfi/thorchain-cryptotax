import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actionsWithTxids } from '../src/pull.ts'

test('actionsWithTxids finds listed actions by tx hash, in any case and with or without 0x', () => {
    const txid = 'ab'.repeat(32)
    const actions = [
        { tags: [], 'Action ID': 'a1', 'Tx Hash': `0x${txid.toUpperCase()}` },
        { tags: [], 'Action ID': 'a2', 'Tx Hash': 'cd'.repeat(32) },
        { tags: [], 'Action ID': 'a3' },
    ]
    assert.deepEqual(actionsWithTxids(actions, new Set([txid])), ['a1'])
})
