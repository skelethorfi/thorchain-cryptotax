// pull: a snapshot of Summ's state, never patched afterwards.
//
//   <state dir>/snapshots/<timestamp>/
//     pages/NNNN.md            every page of the action list, as returned
//     actions.jsonl            one line per action (parsed from the pages)
//     details/<action id>.json full JSON and change history of each action
//                              of a managed source (config.managedSources) and,
//                              given a run dir, of each action whose tx hash is a
//                              txid of a categorised row (a chain not in managedChains).
//                              Copied from the previous snapshot when it holds the same
//                              action id: Summ gives an action a new id whenever it
//                              changes, so only new ids are fetched (unless --full)
//     manifest.json            counts, what was fetched and reused, and from which snapshot

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpClient } from './mcp.ts'
import { type ListedAction, parseActions, parseDetail, parsePageHeader } from './parse.ts'
import { type Config, loadConfig } from './config.ts'
import { readRun, type Row } from './run.ts'
import { latestSnapshot, normaliseTxid } from './snapshot.ts'

const PAGE_SIZE = 250

type Client = Pick<McpClient, 'connect' | 'callTool'>

async function queryAll(client: Client, filter?: Record<string, unknown>): Promise<string[]> {
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
export function categorisedTxids(rows: Row[], config: Config): Set<string> {
    const managed = new Set(config.managedChains)
    return new Set(rows.filter((r) => !managed.has(r.chain)).flatMap((r) => r.txids))
}

/** The ids of the listed actions whose tx hash is one of `txids`. */
export function actionsWithTxids(actions: ListedAction[], txids: Set<string>): string[] {
    return actions.filter((a) => typeof a['Tx Hash'] === 'string' && txids.has(normaliseTxid(a['Tx Hash']))).map((a) => a['Action ID'] as string)
}

/** The previous snapshot's details dir, to copy unchanged actions from; null for a full pull or none. */
function previousDetails(stateDir: string, full: boolean): { name: string; dir: string; ids: Set<string> } | null {
    if (full || !existsSync(join(stateDir, 'snapshots'))) return null
    let base: string
    try {
        base = latestSnapshot(stateDir)
    } catch {
        return null
    }
    const dir = join(base, 'details')
    const ids = new Set(existsSync(dir) ? readdirSync(dir).map((n) => n.replace(/\.json$/, '')) : [])
    return { name: base.split(/[\\/]/).pop() as string, dir, ids }
}

export async function pull(stateDir: string, runDir?: string, { full = false, client = new McpClient(stateDir) as Client } = {}): Promise<string> {
    const config = loadConfig(stateDir)
    const txids = runDir ? categorisedTxids(readRun(runDir).rows, config) : null
    const previous = previousDetails(stateDir, full)
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const dir = join(stateDir, 'snapshots', stamp)
    mkdirSync(join(dir, 'pages'), { recursive: true })
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
    const done = new Set<string>()
    let reused = 0
    const fetchDetails = async (ids: string[]) => {
        const todo = ids.filter((id) => !done.has(id))
        const copy = todo.filter((id) => previous?.ids.has(id))
        for (const actionId of copy) copyFileSync(join(previous!.dir, `${actionId}.json`), join(dir, 'details', `${actionId}.json`))
        copy.forEach((id) => done.add(id))
        reused += copy.length
        const fetch = todo.filter((id) => !done.has(id))
        console.log(`  ${copy.length} unchanged (copied from ${previous?.name ?? '–'}), ${fetch.length} to fetch`)
        for (const [i, actionId] of fetch.entries()) {
            const detail = parseDetail(await client.callTool('inspect_transaction', { actionId }))
            writeFileSync(join(dir, 'details', `${actionId}.json`), JSON.stringify(detail, null, 2) + '\n')
            done.add(actionId)
            process.stdout.write(`\r  ${i + 1}/${fetch.length}   `)
        }
        if (fetch.length) process.stdout.write('\n')
    }
    for (const source of config.managedSources) {
        console.log(`Full detail for source "${source}"`)
        await fetchDetails((await queryAll(client, { type: 'source', value: [source] })).flatMap(parseActions).map((a) => a['Action ID'] as string))
    }
    if (txids) {
        console.log("Full detail for the actions with a categorised row's txid")
        await fetchDetails(actionsWithTxids(actions, txids))
    }

    const manifest = {
        takenAt: new Date().toISOString(),
        total,
        parsed: actions.length,
        unique,
        managedSources: config.managedSources,
        run: runDir ?? null,
        details: done.size,
        reused,
        reusedFrom: previous && reused ? previous.name : null,
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Snapshot written to ${dir}`)
    return dir
}
