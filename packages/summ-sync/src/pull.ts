// pull: a snapshot of Summ's state, never patched afterwards.
//
//   <state dir>/snapshots/<timestamp>/
//     pages/NNNN.md            every page of the action list, as returned
//     actions.jsonl            one line per action (parsed from the pages)
//     details/<action id>.json full JSON and change history of each action
//                              of a managed source (config.managedSources) and,
//                              given a run dir, of each action whose tx hash is a
//                              txid of a categorised row (a chain not in managedChains)
//     manifest.json            counts and what was fetched

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpClient } from './mcp.ts'
import { type ListedAction, parseActions, parseDetail, parsePageHeader } from './parse.ts'
import { type Config, loadConfig } from './config.ts'
import { readRun } from './run.ts'
import { normaliseTxid } from './snapshot.ts'

const PAGE_SIZE = 250

async function queryAll(client: McpClient, filter?: Record<string, unknown>): Promise<string[]> {
    const pages: string[] = []
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

/** The txids of the run's categorised rows: those plan matches to Summ's own imports. */
export function categorisedTxids(runDir: string, config: Config): Set<string> {
    const managed = new Set(config.managedChains)
    return new Set(readRun(runDir).rows.filter((r) => !managed.has(r.chain)).flatMap((r) => r.txids))
}

/** The ids of the listed actions whose tx hash is one of `txids`. */
export function actionsWithTxids(actions: ListedAction[], txids: Set<string>): string[] {
    return actions.filter((a) => typeof a['Tx Hash'] === 'string' && txids.has(normaliseTxid(a['Tx Hash']))).map((a) => a['Action ID'] as string)
}

export async function pull(stateDir: string, runDir?: string): Promise<string> {
    const config = loadConfig(stateDir)
    const txids = runDir ? categorisedTxids(runDir, config) : null
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
    const fetched = new Set<string>()
    const fetchDetails = async (ids: string[]) => {
        for (const [i, actionId] of ids.entries()) {
            const detail = parseDetail(await client.callTool('inspect_transaction', { actionId }))
            writeFileSync(join(dir, 'details', `${actionId}.json`), JSON.stringify(detail, null, 2) + '\n')
            fetched.add(actionId)
            process.stdout.write(`\r  ${i + 1}/${ids.length}   `)
        }
        process.stdout.write('\n')
    }
    for (const source of config.managedSources) {
        console.log(`Fetching full detail for source "${source}"`)
        await fetchDetails((await queryAll(client, { type: 'source', value: [source] })).flatMap(parseActions).map((a) => a['Action ID'] as string))
    }
    if (txids) {
        const ids = actionsWithTxids(actions, txids).filter((id) => !fetched.has(id))
        console.log(`Fetching full detail for ${ids.length} actions with a categorised row's txid`)
        await fetchDetails(ids)
    }
    const details = fetched.size

    const manifest = { takenAt: new Date().toISOString(), total, parsed: actions.length, unique, managedSources: config.managedSources, run: runDir ?? null, details }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Snapshot written to ${dir}`)
    return dir
}
