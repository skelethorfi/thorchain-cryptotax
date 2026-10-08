import { test } from 'node:test'
import assert from 'node:assert/strict'
import { McpClient, READ_TOOLS } from '../src/mcp.ts'

test('a client refuses tools it was not created with, before any request', async () => {
    const client = new McpClient('/nonexistent')
    await assert.rejects(client.callTool('bulk_edit_transactions', {}), /Refusing to call/)
})

test('the default tools are read-only', () => {
    assert.deepEqual(READ_TOOLS, ['query_summ_transactions', 'inspect_transaction', 'get_filter_options'])
})
