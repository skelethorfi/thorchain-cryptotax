// apply: carries out a reviewed plan through Summ's MCP (spec: docs/specs/summ-sync.md, Apply).
//
//   1. refuse a plan whose snapshot is not the latest, or that Summ changed under since (apply-log.jsonl)
//   2. deletes (--approve-deletes): each leg looked up by _id, and only actions that hold nothing but the
//      entry's legs are deleted, by action id; a leg that shares its action with other legs is refused
//   3. edits and categorisation, each action looked up again by leg _id and checked against the plan's Summ value;
//      then the receive Summ made up to pair a categorised send as a transfer is ignored, once it is alone.
//      Categorisation waits while the plan has uploads: Summ pairs a categorised leg with the uploaded other
//      side of the swap only when that side is already there
//   4. list the upload files for the user
//   5. every call, its result and undo handle go to <state dir>/apply-log.jsonl as they happen
//
// Filed-year entries are applied only with --approve-filed, and then only they: a separate apply.

import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { parseActions, parseDetail } from './parse.ts'
import { type DeleteEntry, type EditEntry, type Plan, same } from './plan.ts'
import { type Leg, latestSnapshot, legsOf } from './snapshot.ts'

export const WRITE_TOOLS = ['edit_transaction', 'bulk_edit_transactions']

export interface ToolCaller {
    callTool(name: string, args: Record<string, unknown>): Promise<string>
}

export interface ApplyOptions {
    approveDeletes: boolean
    approveFiled: boolean
    /** Look everything up and check it, but write nothing to Summ and nothing to the log. */
    dryRun: boolean
}

export type PlanFile = Plan & { snapshot: string; run: string }

export interface LogLine {
    time: string
    plan: string
    call: string
    [key: string]: unknown
}

export interface ApplyResult {
    deleted: number
    edited: number
    /** Categorisations held back until the plan's uploads are in Summ. */
    heldBack: number
    skipped: { id: string | null; reason: string }[]
    uploads: { file: string; rows: number }[]
}

/** The plan's folder and plan.json, given either. */
export function readPlanFile(path: string): { dir: string; plan: PlanFile } {
    const file = existsSync(join(path, 'plan.json')) ? join(path, 'plan.json') : path
    return { dir: dirname(file), plan: JSON.parse(readFileSync(file, 'utf8')) }
}

/** Refuses a plan made from an older snapshot, or one Summ was written to after the snapshot was taken. */
export function checkFresh(stateDir: string, plan: PlanFile): void {
    const latest = latestSnapshot(stateDir)
    if (basename(latest) !== plan.snapshot) {
        throw new Error(`The plan is from snapshot ${plan.snapshot}, the latest is ${basename(latest)}: plan again`)
    }
    const takenAt = JSON.parse(readFileSync(join(latest, 'manifest.json'), 'utf8')).takenAt as string
    const log = join(stateDir, 'apply-log.jsonl')
    const later = existsSync(log)
        ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as LogLine).filter((l) => l.time > takenAt && l.call !== 'skip')
        : []
    if (later.length) throw new Error(`apply-log.jsonl has ${later.length} writes since snapshot ${plan.snapshot} was taken: pull and plan again`)
}

/** The plan's entries this apply carries out: the current year's, or with approveFiled only the filed years'. */
export function selected<T extends { filed: boolean }>(entries: T[], opts: ApplyOptions): T[] {
    return entries.filter((e) => e.filed === opts.approveFiled)
}

/** The bulk edit id (undo handle) in an edit's result text, if it has one. */
export function undoHandle(text: string): string | null {
    return text.match(/Bulk Edit ID\W*([A-Za-z0-9_-]{8,})/i)?.[1] ?? null
}

// Candidates only: the id filter lists the leg's action but can list unrelated actions too, even with
// showAssociated 0, so each is inspected, and a write never selects by this filter
const idFilter = (legIds: string[]) => ({ type: 'id', value: legIds, showAssociated: 0 })

type Found = { actionId: string; legs: Leg[] }

/** The action that holds a leg now (action ids change on every write) and its legs. */
async function lookUp(client: ToolCaller, legId: string): Promise<Found | null> {
    const listed = parseActions(await client.callTool('query_summ_transactions', { filter: idFilter([legId]), includeHidden: true, count: 50 }))
    for (const actionId of new Set(listed.map((a) => a['Action ID'] as string))) {
        const legs = legsOf(parseDetail(await client.callTool('inspect_transaction', { actionId })))
        if (legs.some((l) => l.legId === legId)) return { actionId, legs }
    }
    return null
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function applyPlan(
    client: ToolCaller,
    plan: PlanFile,
    planName: string,
    opts: ApplyOptions,
    log: (line: Omit<LogLine, 'time' | 'plan'>) => void,
    say: (text: string) => void = console.log,
    /** Summ rebuilds actions and refreshes its search a few seconds after a write. */
    settleMs = 3000,
): Promise<ApplyResult> {
    const result: ApplyResult = { deleted: 0, edited: 0, heldBack: 0, skipped: [], uploads: [] }
    const write = opts.dryRun ? null : log
    const skip = (id: string | null, reason: string, extra: Record<string, unknown> = {}): false => {
        result.skipped.push({ id, reason })
        say(`  skipped ${id ?? '(no row)'}: ${reason}`)
        write?.({ call: 'skip', id, reason, ...extra })
        return false
    }

    // ---- Deletes
    const deletes = selected(plan.delete, opts)
    if (deletes.length && !opts.approveDeletes) say(`Deletes: ${deletes.length} not applied (needs --approve-deletes)`)
    else if (deletes.length) say(`Deletes: ${deletes.length}`)
    for (const entry of opts.approveDeletes ? deletes : []) await applyDelete(entry)

    async function applyDelete(entry: DeleteEntry) {
        if (entry.otherLegs > 0) {
            // Whether a delete selected by leg _id keeps the other legs of the action is not yet shown
            return skip(entry.id, `its actions hold ${entry.otherLegs} other legs`, { legIds: entry.legIds })
        }
        const actionIds = new Set<string>()
        for (const legId of entry.legIds) {
            const found = await lookUp(client, legId)
            if (!found) return skip(entry.id, `leg ${legId} is no longer in Summ`, { legIds: entry.legIds })
            const others = found.legs.filter((l) => !entry.legIds.includes(l.legId))
            if (others.length) return skip(entry.id, `leg ${legId} now shares its action with ${others.length} other legs`, { legIds: entry.legIds })
            actionIds.add(found.actionId)
        }
        // By the actions just inspected, which hold only the entry's legs: never by a filter
        const args = { actionIds: [...actionIds], operation: { type: 'delete' } }
        if (!write) return say(`  would delete ${entry.legIds.length} legs of ${entry.summId}`)
        const text = await client.callTool('bulk_edit_transactions', args)
        result.deleted++
        write({ call: 'bulk_edit_transactions', operation: 'delete', id: entry.id, summId: entry.summId, legIds: entry.legIds, actionIds: [...actionIds], result: text })
    }

    // ---- Edits, then categorisation: the same call on a managed row's legs or on Summ's own leg
    const uploads = selected(plan.upload, opts)
    const categorise = selected(plan.categorise, opts)
    if (uploads.length && categorise.length) {
        result.heldBack = categorise.length
        say(`Categorisation: ${categorise.length} held back until the uploads are in Summ`)
    }
    const edits = [...selected(plan.edit, opts).map((e) => ['edit', e] as const), ...(uploads.length ? [] : categorise).map((e) => ['categorise', e] as const)]
    if (edits.length) say(`Edits and categorisation: ${edits.length}`)
    for (const [kind, entry] of edits) await applyEdit(kind, entry)

    async function applyEdit(kind: string, entry: EditEntry) {
        if (entry.changes.length && !(await editLegs(kind, entry))) return
        for (const legId of entry.ignore ?? []) await ignoreMadeUp(entry, legId, entry.changes.length > 0)
    }

    /** Summ's made-up other side of a transfer, once the categorised leg is split off: ignored, by action id. */
    async function ignoreMadeUp(entry: EditEntry, legId: string, afterEdit: boolean) {
        if (!write) return say(`  would ignore the made-up receive ${legId} of ${entry.id}`)
        let found: Found | null = null
        for (let attempt = 0; attempt < 5; attempt++) {
            if (afterEdit || attempt > 0) await sleep(settleMs)
            found = await lookUp(client, legId)
            if (found && found.legs.length === 1) break
        }
        if (!found) return skip(entry.id, `made-up receive ${legId} is no longer in Summ`)
        const leg = found.legs.find((l) => l.legId === legId) as Leg
        if (found.legs.length !== 1) return skip(entry.id, `made-up receive ${legId} still shares its action with ${found.legs.length - 1} other legs`)
        if (leg.importType !== 'soft-transfer') return skip(entry.id, `leg ${legId} is not a made-up receive (${leg.importType})`)
        if (leg.trade === 'ignoreIn' || leg.trade === 'ignoreOut') return say(`  made-up receive ${legId} of ${entry.id} is already ignored`)
        const text = await client.callTool('bulk_edit_transactions', { actionIds: [found.actionId], operation: { type: 'ignore' } })
        const undo = undoHandle(text)
        write({ call: 'bulk_edit_transactions', operation: 'ignore', id: entry.id, legIds: [legId], actionIds: [found.actionId], undo, result: text })
        say(`  ignored the made-up receive of ${entry.id}${undo ? ` (undo ${undo})` : ''}`)
    }

    /** True when the edit was made. */
    async function editLegs(kind: string, entry: EditEntry): Promise<boolean> {
        const found = await lookUp(client, entry.changes[0].legId)
        if (!found) return skip(entry.id, `leg ${entry.changes[0].legId} is no longer in Summ`)
        for (const change of entry.changes) {
            const leg = found.legs.find((l) => l.legId === change.legId)
            if (!leg) return skip(entry.id, `leg ${change.legId} is no longer in the action of leg ${entry.changes[0].legId}`)
            const now = leg[change.field as keyof Leg] as string | number
            if (!same(change.field, now, change.summ)) {
                return skip(entry.id, `${change.field} of leg ${change.legId} is ${JSON.stringify(now)} in Summ, the plan expected ${JSON.stringify(change.summ)}`)
            }
        }
        const byLeg = new Map<string, Record<string, unknown>>()
        for (const c of entry.changes) byLeg.set(c.legId, { ...byLeg.get(c.legId), [c.field]: c.desired })
        const args = { actionId: found.actionId, edits: [...byLeg].map(([transactionId, updates]) => ({ transactionId, updates })) }
        const summary = entry.changes.map((c) => `${c.field} ${JSON.stringify(c.summ)} -> ${JSON.stringify(c.desired)}`).join(', ')
        if (!write) {
            say(`  would ${kind} ${entry.id}: ${summary}`)
            return true
        }
        const text = await client.callTool('edit_transaction', args)
        result.edited++
        const undo = undoHandle(text)
        // One line per change, in the shape plan reads back (legId, field, value) to tell the sync's own edits from drift
        for (const c of entry.changes) write({ call: 'edit_transaction', kind, id: entry.id, actionId: found.actionId, legId: c.legId, field: c.field, from: c.summ, value: c.desired, undo })
        write({ call: 'edit_transaction', kind, id: entry.id, actionId: found.actionId, undo, result: text })
        say(`  ${kind} ${entry.id}: ${summary}${undo ? ` (undo ${undo})` : ''}`)
        return true
    }

    for (const u of uploads) result.uploads.push({ file: u.filed ? u.file.replace(/\.csv$/, '_filed.csv') : u.file, rows: u.ids.length })
    return result
}

export async function runApply(client: ToolCaller & { connect(): Promise<void> }, stateDir: string, planPath: string, opts: ApplyOptions): Promise<ApplyResult> {
    const { dir, plan } = readPlanFile(planPath)
    checkFresh(stateDir, plan)
    const planName = basename(dir)
    const logFile = join(stateDir, 'apply-log.jsonl')
    const log = (line: Omit<LogLine, 'time' | 'plan'>) => appendFileSync(logFile, JSON.stringify({ time: new Date().toISOString(), plan: planName, ...line }) + '\n')
    console.log(`${opts.dryRun ? 'Dry run of' : 'Applying'} ${planName} (${opts.approveFiled ? 'filed years only' : 'current years only'})`)
    await client.connect()
    let result: ApplyResult
    try {
        result = await applyPlan(client, plan, planName, opts, log)
    } catch (e) {
        // Stop at the first failure; a failed write may still have changed Summ, so it counts as a write
        if (!opts.dryRun) log({ call: 'error', error: e instanceof Error ? e.message : String(e) })
        throw e
    }

    const uploadDir = join(dir, 'upload')
    const present = new Set(existsSync(uploadDir) ? readdirSync(uploadDir) : [])
    console.log(`\nDeleted ${result.deleted}, edited ${result.edited}, skipped ${result.skipped.length}, held back ${result.heldBack}`)
    if (result.uploads.length) {
        console.log(`Upload these files in Summ (${uploadDir}):`)
        for (const u of result.uploads) console.log(`  ${u.file}: ${u.rows} rows${present.has(u.file) ? '' : ' (missing!)'}`)
        console.log('Then pull, plan and apply again.')
    } else console.log('Then pull and plan again.')
    return result
}
