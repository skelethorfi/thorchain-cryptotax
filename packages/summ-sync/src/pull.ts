// pull: a snapshot of Summ's state, never patched afterwards.
//
//   <state dir>/snapshots/<timestamp>/
//     pages/NNNN.md            every page of the action list, as returned
//     actions.jsonl            one line per action (parsed from the pages)
//     details/<action id>.json full JSON and change history of each action
//                              of a managed source (config.managedSources) and,
//                              given a run dir, of each action whose tx hash is a
//                              txid of a categorised row (a chain not in managedChains).
//                              Given a run dir, only the managed actions dated in the
//                              run's periods (a day either side for the timezone)
//     manifest.json            counts, what was fetched, and detailPeriods (null: all years)

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { McpClient } from './mcp.ts'
import { type ListedAction, parseActions, parseDetail, parsePageHeader } from './parse.ts'
import { type Config, loadConfig } from './config.ts'
import { nextDay, startOfDay } from './dates.ts'
import { type Period, periodsOf, readRun, type Row } from './run.ts'
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
export function categorisedTxids(rows: Row[], config: Config): Set<string> {
    const managed = new Set(config.managedChains)
    return new Set(rows.filter((r) => !managed.has(r.chain)).flatMap((r) => r.txids))
}

const DAY_MS = 24 * 60 * 60 * 1000

/** A filter for actions dated in any of the periods, with a day's margin either side (plan scopes exactly). */
export function periodsFilter(periods: Period[], timeZone: string): Record<string, unknown> {
    return {
        type: 'or',
        rules: periods.map((p) => ({
            type: 'and',
            rules: [
                { type: 'after', value: startOfDay(p.from, timeZone) - DAY_MS },
                { type: 'before', value: startOfDay(nextDay(p.to), timeZone) + DAY_MS },
            ],
        })),
    }
}

/** The ids of the listed actions whose tx hash is one of `txids`. */
export function actionsWithTxids(actions: ListedAction[], txids: Set<string>): string[] {
    return actions.filter((a) => typeof a['Tx Hash'] === 'string' && txids.has(normaliseTxid(a['Tx Hash']))).map((a) => a['Action ID'] as string)
}

export async function pull(stateDir: string, runDir?: string): Promise<string> {
    const config = loadConfig(stateDir)
    const run = runDir ? readRun(runDir) : null
    const txids = run ? categorisedTxids(run.rows, config) : null
    const periods = run ? periodsOf(run.files) : null
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
        const bySource = { type: 'source', value: [source] }
        console.log(`Fetching full detail for source "${source}"${periods ? ` in ${periods.map((p) => `${p.from} to ${p.to}`).join(', ')}` : ', all years'}`)
        const filter = periods ? { type: 'and', rules: [bySource, periodsFilter(periods, config.timezone)] } : bySource
        await fetchDetails((await queryAll(client, filter)).flatMap(parseActions).map((a) => a['Action ID'] as string))
    }
    if (txids) {
        const ids = actionsWithTxids(actions, txids).filter((id) => !fetched.has(id))
        console.log(`Fetching full detail for ${ids.length} actions with a categorised row's txid`)
        await fetchDetails(ids)
    }
    const details = fetched.size

    const manifest = { takenAt: new Date().toISOString(), total, parsed: actions.length, unique, managedSources: config.managedSources, run: runDir ?? null, detailPeriods: periods, details }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    console.log(`Snapshot written to ${dir}`)
    return dir
}
