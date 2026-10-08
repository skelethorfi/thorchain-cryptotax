// pull: a snapshot of Summ's state, never patched afterwards.
//
//   <state dir>/snapshots/<timestamp>/
//     pages/NNNN.md            every page of the action list, as returned
//     actions.jsonl            one line per action (parsed from the pages)
//     details/<action id>.json full JSON and change history of each action
//                              of a managed source (config.managedSources)
//     manifest.json            counts and what was fetched

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpClient } from './mcp.mjs'
import { parseActions, parseDetail, parsePageHeader } from './parse.mjs'
import { loadConfig } from './config.mjs'

const PAGE_SIZE = 250

async function queryAll(client, filter) {
    const pages = []
    for (let page = 1; ; page++) {
        const text = await client.callTool('query_summ_transactions', {
            count: PAGE_SIZE,
            page,
            sort: 'oldestFirst',
            includeHidden: true,
            ...(filter ? { filter } : {}),
        })
        pages.push(text)
        const header = parsePageHeader(text)
        process.stdout.write(`\r  page ${header.page}/${header.pages} (${header.total} total)   `)
        if (header.page >= header.pages) break
    }
    process.stdout.write('\n')
    return pages
}

export async function pull(stateDir) {
    const config = loadConfig(stateDir)
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const dir = join(stateDir, 'snapshots', stamp)
    mkdirSync(join(dir, 'pages'), { recursive: true })
    const client = new McpClient(stateDir)
    await client.connect()

    console.log('Fetching every action (including ignored, spam and dust)')
    const pages = await queryAll(client)
    pages.forEach((text, i) => writeFileSync(join(dir, 'pages', `${String(i + 1).padStart(4, '0')}.md`), text))
    const actions = pages.flatMap(parseActions)
    writeFileSync(join(dir, 'actions.jsonl'), actions.map((a) => JSON.stringify(a)).join('\n') + '\n')

    const total = parsePageHeader(pages[0]).total
    const unique = new Set(actions.map((a) => a['Action ID'])).size
    console.log(`  ${actions.length} actions parsed, ${unique} unique, server reported ${total}`)
    if (unique !== total) console.log('  WARNING: counts differ. The data changed during the pull or the parser missed rows; check pages/.')

    mkdirSync(join(dir, 'details'), { recursive: true })
    let details = 0
    for (const source of config.managedSources) {
        console.log(`Fetching full detail for source "${source}"`)
        const ids = (await queryAll(client, { type: 'source', value: [source] })).flatMap(parseActions).map((a) => a['Action ID'])
        for (const [i, actionId] of ids.entries()) {
            const detail = parseDetail(await client.callTool('inspect_transaction', { actionId }))
            writeFileSync(join(dir, 'details', `${actionId}.json`), JSON.stringify(detail, null, 2) + '\n')
            process.stdout.write(`\r  ${i + 1}/${ids.length}   `)
        }
        process.stdout.write('\n')
        details += ids.length
    }

    const manifest = { takenAt: new Date().toISOString(), total, parsed: actions.length, unique, managedSources: config.managedSources, details }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Snapshot written to ${dir}`)
    return dir
}
