#!/usr/bin/env node
// summ-sync: keep Summ matching a set of Summ CSV files (README.md).

import { login, READ_SCOPE, WRITE_SCOPE } from '../src/auth.mjs'
import { McpClient } from '../src/mcp.mjs'
import { pull } from '../src/pull.mjs'

const USAGE = `Usage:
  summ-sync login <state dir> [--write]   authorise in the browser (read, or read and write)
  summ-sync pull  <state dir>             snapshot Summ into <state dir>/snapshots/
  summ-sync tools <state dir>             list the MCP server's tools`

const [command, stateDir, ...rest] = process.argv.slice(2)
try {
    if (!stateDir) throw new Error(USAGE)
    if (command === 'login') await login(stateDir, rest.includes('--write') ? WRITE_SCOPE : READ_SCOPE)
    else if (command === 'pull') await pull(stateDir)
    else if (command === 'tools') {
        const client = new McpClient(stateDir)
        await client.connect()
        for (const t of await client.listTools()) console.log(`${t.name}${t.annotations?.readOnlyHint ? ' (read-only)' : ''}`)
    } else throw new Error(USAGE)
} catch (e) {
    console.error(e.message.startsWith('Usage') ? e.message : `Error: ${e.message}`)
    process.exit(1)
}
