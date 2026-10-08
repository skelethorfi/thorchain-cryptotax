#!/usr/bin/env node
// summ-sync: keep Summ matching a set of Summ CSV files (README.md).

import { login, READ_SCOPE, WRITE_SCOPE } from '../src/auth.ts'
import { McpClient } from '../src/mcp.ts'
import { pull } from '../src/pull.ts'
import { writePlan } from '../src/write-plan.ts'

const USAGE = `Usage:
  summ-sync login <state dir> [--write]   authorise in the browser (read, or read and write)
  summ-sync pull  <state dir>             snapshot Summ into <state dir>/snapshots/
  summ-sync plan  <state dir> <run dir>   compare a run with the latest snapshot (calls nothing)
  summ-sync tools <state dir>             list the MCP server's tools`

const [command, stateDir, ...rest] = process.argv.slice(2)
try {
    if (!stateDir) throw new Error(USAGE)
    if (command === 'login') await login(stateDir, rest.includes('--write') ? WRITE_SCOPE : READ_SCOPE)
    else if (command === 'pull') await pull(stateDir)
    else if (command === 'plan') {
        if (!rest[0]) throw new Error(USAGE)
        writePlan(stateDir, rest[0])
    }
    else if (command === 'tools') {
        const client = new McpClient(stateDir)
        await client.connect()
        for (const t of await client.listTools()) console.log(`${t.name}${t.annotations?.readOnlyHint ? ' (read-only)' : ''}`)
    } else throw new Error(USAGE)
} catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(message.startsWith('Usage') ? message : `Error: ${message}`)
    process.exit(1)
}
