import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { actionsWithTxids, pull } from '../src/pull.ts'

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


/** Summ as a fake MCP server: the listed actions, all of the managed source; counts inspect calls. */
function fakeSumm(actionIds: string[]) {
    const inspected: string[] = []
    const client = {
        connect: async () => {},
        callTool: async (name: string, args: Record<string, unknown>) => {
            if (name === 'query_summ_transactions') {
                const blocks = actionIds.map((id, i) => `## ${i + 1}. send\n- **Action ID**: \`${id}\`\n- **Tx Hash**: \`h${id}\``)
                return `# Transactions (Page 1 of 1, ${actionIds.length} returned, ${actionIds.length} total)\n\n${blocks.join('\n\n')}`
            }
            inspected.push(args.actionId as string)
            return `\`\`\`json\n${JSON.stringify({ _id: args.actionId, outgoing: [] })}\n\`\`\`\n## Change History\n`
        },
    }
    return { client, inspected }
}

test('pull fetches only the actions whose id is new since the last snapshot, and copies the rest', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'summ-sync-pull-'))
    writeFileSync(join(stateDir, 'summ-sync.json'), JSON.stringify({ managedSources: ['csv-source'] }))
    const log = console.log
    console.log = () => {}
    try {
        const first = fakeSumm(['a1', 'a2', 'a3'])
        await pull(stateDir, undefined, { client: first.client })
        assert.deepEqual(first.inspected.sort(), ['a1', 'a2', 'a3'])
        await new Promise((r) => setTimeout(r, 1100)) // snapshots are named by the second
        // a2 was edited (a new id, a4), a3 deleted, a5 added
        const second = fakeSumm(['a1', 'a4', 'a5'])
        const dir = await pull(stateDir, undefined, { client: second.client })
        assert.deepEqual(second.inspected.sort(), ['a4', 'a5'])
        assert.deepEqual(readdirSync(join(dir, 'details')).sort(), ['a1.json', 'a4.json', 'a5.json'])
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
        assert.deepEqual([manifest.details, manifest.reused], [3, 1])
        await new Promise((r) => setTimeout(r, 1100))
        const full = fakeSumm(['a1', 'a4', 'a5'])
        await pull(stateDir, undefined, { client: full.client, full: true })
        assert.deepEqual(full.inspected.sort(), ['a1', 'a4', 'a5'])
    } finally {
        console.log = log
    }
})
