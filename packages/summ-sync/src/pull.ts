// pull: a snapshot of Summ's state, never patched afterwards (spec: docs/specs/summ-sync.md, State dir).
//
//   <state dir>/snapshots/<time>.json   the counts, and one entry per listed action (id, tx hash, category, tags)
//   <state dir>/actions/<id>.json       the full JSON and change history of each action the plan needs: every
//                                       action of a managed source (config.managedSources) and, given a run dir,
//                                       each action whose tx hash is a txid of a categorised row (a chain not in
//                                       managedChains). Fetched only when the store lacks the id: Summ gives an
//                                       action a new id whenever it changes. --full fetches them all again and
//                                       reports any stored id whose legs or history differ

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { McpClient } from './mcp.ts'
import { type ListedAction, parseActions, parseDetail, parsePageHeader } from './parse.ts'
import { type Config, extraDirsOf, loadConfig } from './config.ts'
import { readRun, type Row } from './run.ts'
import { actionFile, normaliseTxid, readAction, type SnapshotEntry, storeAction, syncView, writeSnapshot } from './snapshot.ts'

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

const str = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '')

/** A listed action as the snapshot keeps it. */
export function snapshotEntry(a: ListedAction): SnapshotEntry {
    return { id: a['Action ID'] as string, txHash: str(a['Tx Hash']), category: str(a['Action Category']), tags: a.tags }
}

export async function pull(stateDir: string, runDir?: string, { full = false, client = new McpClient(stateDir) as Client } = {}): Promise<string> {
    const config = loadConfig(stateDir)
    const txids = runDir ? categorisedTxids(readRun(runDir, extraDirsOf(stateDir, config)).rows, config) : null
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    const file = join(stateDir, 'snapshots', `${stamp}.json`)
    await client.connect()

    console.log('Fetching every action (including ignored, spam and dust)')
    const pages = await queryAll(client)
    const actions = pages.flatMap(parseActions)
    const total = parsePageHeader(pages[0]).total
    const unique = new Set(actions.map((a) => a['Action ID'])).size
    console.log(`  ${actions.length} actions parsed, ${unique} unique, server reported ${total}`)
    if (unique !== total) console.log('  WARNING: counts differ. The data changed during the pull or the parser missed rows.')

    const needed = new Set<string>()
    let stored = 0
    let fetched = 0
    const differs: string[] = []
    const fetchDetails = async (ids: string[]) => {
        const todo = [...new Set(ids)].filter((id) => !needed.has(id))
        todo.forEach((id) => needed.add(id))
        const fetch = full ? todo : todo.filter((id) => !existsSync(actionFile(stateDir, id)))
        stored += todo.length - fetch.length
        console.log(`  ${todo.length - fetch.length} already in the store, ${fetch.length} to fetch`)
        for (const [i, actionId] of fetch.entries()) {
            const detail = parseDetail(await client.callTool('inspect_transaction', { actionId }))
            const before = full ? readAction(stateDir, actionId) : null
            const changed = before !== null && syncView(before) !== syncView(detail)
            if (changed) differs.push(actionId)
            storeAction(stateDir, detail, changed)
            fetched++
            process.stdout.write(`\r  ${i + 1}/${fetch.length}   `)
        }
        if (fetch.length) process.stdout.write('\n')
    }
    // An action Summ rebuilt while the full list was paged appears under its new id only in the source query:
    // it joins the snapshot's entries, so plan reads its legs
    const listed = new Set(actions.map((a) => a['Action ID']))
    const late: ListedAction[] = []
    for (const source of config.managedSources) {
        console.log(`Full detail for source "${source}"`)
        const sourceActions = (await queryAll(client, { type: 'source', value: [source] })).flatMap(parseActions)
        for (const a of sourceActions) {
            if (listed.has(a['Action ID'])) continue
            listed.add(a['Action ID'])
            late.push(a)
        }
        await fetchDetails(sourceActions.map((a) => a['Action ID'] as string))
    }
    if (late.length) console.log(`  WARNING: ${late.length} actions of a managed source were not in the full list (Summ changed during the pull); added to the snapshot`)
    if (txids) {
        console.log("Full detail for the actions with a categorised row's txid")
        await fetchDetails(actionsWithTxids(actions, txids))
    }
    if (differs.length) {
        console.log(`WARNING: ${differs.length} stored actions differ from Summ under the same id (replaced; the old versions are in git if committed):`)
        for (const id of differs) console.log(`  ${id}`)
    }

    writeSnapshot(file, {
        takenAt: new Date().toISOString(),
        total,
        parsed: actions.length,
        unique,
        managedSources: config.managedSources,
        run: runDir ?? null,
        late: late.length,
        details: needed.size,
        stored,
        fetched,
        ...(full ? { differs } : {}),
        actions: [...actions, ...late].map((a) => ({ ...snapshotEntry(a), ...(needed.has(a['Action ID'] as string) ? { detail: true as const } : {}) })),
    })
    console.log(`Snapshot written to ${file}`)
    return file
}
