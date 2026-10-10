// plan: the differences between a run (the desired state) and a snapshot of Summ. Pure: it reads nothing and
// calls nothing; the CLI (writePlan) reads the inputs and writes the plan. Spec: docs/specs/summ-sync.md.

import type { Config } from './config.ts'
import { before, inPeriod } from './dates.ts'
import { periodsOf, type Row, type RunFile } from './run.ts'
import { type Leg, normaliseTxid } from './snapshot.ts'
import type { AppliedEdit, LegRole, Override, Value } from './state.ts'
import { type SummType, summBlockchain, summType } from './summ-types.ts'

export interface PlanInput {
    files: RunFile[]
    rows: Row[]
    legs: Leg[]
    history: Map<string, string[]>
    txHashes: Set<string>
    config: Config
    adopted: Map<string, string>
    overrides: Override[]
    applyLog: AppliedEdit[]
    now: string
}

export interface Change {
    leg: LegRole
    legId: string
    field: string
    summ: Value
    desired: Value
}

/** Edits of one row's legs (managed) or of Summ's own leg (categorised). */
export interface EditEntry {
    id: string
    filed: boolean
    actionId: string
    changes: Change[]
    /**
     * Categorised only: the other side Summ made up to pair its leg as a transfer (importType soft-transfer), to
     * be ignored once the leg is categorised and Summ has split it off into an action of its own.
     */
    ignore?: string[]
}

export interface DeleteEntry {
    /** The row the legs belong to, or null when the run has no row for them. */
    id: string | null
    /** The ID the legs carry in Summ. */
    summId: string
    filed: boolean
    legIds: string[]
    actionIds: string[]
    reason: string
    /** Legs of other rows or sources in the same actions (deleting by action would remove them too). */
    otherLegs: number
}

export interface UploadEntry {
    file: string
    filed: boolean
    ids: string[]
}

export interface ReportEntry {
    kind: 'no-leg' | 'several-legs' | 'leg-claimed-twice' | 'not-in-snapshot' | 'fee' | 'ambiguous-adoption' | 'manual-entry' | 'other-source'
    filed: boolean
    id?: string
    legIds?: string[]
    /** The row's txids: the inbound first, then, on an L1 payout, the one Summ's import lists. */
    txids?: string[]
    detail: string
}

export interface OverriddenEntry {
    kind: 'captured' | 'run-changed' | 'gone'
    override: Override
    /** For run-changed: the run's value now. */
    runNow?: Value
}

export interface Plan {
    createdAt: string
    managedChains: string[]
    managedSources: string[]
    filedBefore: string | null
    timezone: string
    periods: { from: string; to: string }[]
    counts: Record<string, number>
    adopted: { legId: string; id: string }[]
    delete: DeleteEntry[]
    edit: EditEntry[]
    upload: UploadEntry[]
    categorise: EditEntry[]
    report: ReportEntry[]
    overridden: OverriddenEntry[]
    notes: string[]
}

export interface PlanResult {
    plan: Plan
    /** adopted.csv after this plan: the input's plus the legs adopted now. */
    adopted: Map<string, string>
    /** overrides.json after this plan: the input's plus the ones captured now. */
    overrides: Override[]
}

const SOFT_TRANSFER = 'soft-transfer'
const IGNORED = new Set(['ignoreIn', 'ignoreOut'])

const STABLE_ID = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.[a-z-]+\.[0-9a-f]{12}$/

// Change-history labels of the fields the plan edits (inspect_transaction, "## Change History")
const HISTORY_LABELS: Record<string, string> = {
    trade: 'Category',
    quantity: 'Quantity',
    timestamp: 'Date',
    from: 'From',
    to: 'To',
    blockchain: 'Blockchain',
}

/**
 * A difference below 1e-8 of the amount, or of one unit at the 8th decimal, is equal: the exporter's amounts
 * carry THORChain's 8 decimals, while Summ's own imports hold an L1 amount (e.g. ETH gas) in full.
 */
export function sameAmount(a: number, b: number): boolean {
    return Math.abs(a - b) <= Math.max(1e-8 * Math.max(Math.abs(a), Math.abs(b)), 1.000001e-8)
}

const seconds = (time: string) => Math.floor(Date.parse(time) / 1000)

export function same(field: string, a: Value, b: Value): boolean {
    if (a === null || b === null || a === '' || b === '') return (a ?? '') === (b ?? '')
    if (field === 'quantity') return sameAmount(Number(a), Number(b))
    if (field === 'timestamp') return seconds(String(a)) === seconds(String(b))
    if (field === 'trade') return a === b
    return String(a).toLowerCase() === String(b).toLowerCase()
}

const sameCurrency = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
const hasFee = (row: Row) => row.feeAmount !== '' && Number(row.feeAmount) !== 0
const hasQuote = (row: Row, type: SummType) => type.quote !== undefined && row.quoteCurrency !== ''
const typeOf = (row: Row) => summType(row.type) as SummType

/** The row's base, quote and fee legs among `legs`, or why the legs do not have the row's shape. */
function shapeOf(row: Row, legs: Leg[]): { base: Leg; quote?: Leg; fee?: Leg } | string {
    const type = typeOf(row)
    const nonFee = legs.filter((l) => l.side !== 'fees')
    const fees = legs.filter((l) => l.side === 'fees')
    const base = nonFee.filter((l) => l.side === type.side)
    const quote = nonFee.filter((l) => l.side !== type.side)
    const wantQuote = hasQuote(row, type) ? 1 : 0
    const wantFee = hasFee(row) ? 1 : 0
    if (base.length !== 1 || quote.length !== wantQuote || fees.length !== wantFee) {
        return `shape: Summ has ${base.length} ${type.side}, ${quote.length} opposite and ${fees.length} fee legs; the row needs 1, ${wantQuote} and ${wantFee}`
    }
    return { base: base[0], quote: quote[0], fee: fees[0] }
}

export function makePlan(input: PlanInput): PlanResult {
    const { config, now } = input
    const unmapped = [...new Set(input.rows.map((r) => r.type).filter((t) => !summType(t)))]
    if (unmapped.length) throw new Error(`No Summ type for CSV type ${unmapped.join(', ')}: add it to src/summ-types.ts`)

    const managedChains = new Set(config.managedChains)
    const managedSources = new Set(config.managedSources)
    const periods = periodsOf(input.files)
    const inScope = (time: string) => periods.some((p) => inPeriod(time, p, config.timezone))
    const isFiled = (time: string) => config.filedBefore !== null && before(time, config.filedBefore, config.timezone)

    const adopted = new Map(input.adopted)
    let overrides = [...input.overrides]
    const plan: Plan = {
        createdAt: now,
        managedChains: config.managedChains,
        managedSources: config.managedSources,
        filedBefore: config.filedBefore,
        timezone: config.timezone,
        periods,
        counts: {},
        adopted: [],
        delete: [],
        edit: [],
        upload: [],
        categorise: [],
        report: [],
        overridden: [],
        notes: [],
    }
    const legsByAction = new Map<string, Leg[]>()
    for (const leg of input.legs) legsByAction.set(leg.actionId, [...(legsByAction.get(leg.actionId) ?? []), leg])
    const unmappedChains = new Set<string>()

    // Drift and overrides: a change the plan would make is kept as the user's when an override says so, or
    // when the action's history shows the user changed that field and apply-log has no such edit.
    function resolve(id: string, actionId: string, change: Change): Change | null {
        const override = overrides.find((o) => o.id === id && o.leg === change.leg && o.field === change.field)
        const desired = override ? override.summ : change.desired
        if (override && !same(change.field, override.run, change.desired)) {
            plan.overridden.push({ kind: 'run-changed', override, runNow: change.desired })
        }
        if (same(change.field, change.summ, desired)) return null
        const label = HISTORY_LABELS[change.field]
        const userEdited = (input.history.get(actionId) ?? []).some((h) => h.split(' · user · ')[1]?.includes(`${label}:`))
        const ours = input.applyLog.some((e) => e.legId === change.legId && e.field === change.field && same(change.field, e.value, change.summ))
        if (label && userEdited && !ours) {
            const captured: Override = { id, leg: change.leg, field: change.field, run: change.desired, summ: change.summ, seenAt: now, reason: '' }
            overrides = [...overrides.filter((o) => o !== override), captured]
            plan.overridden.push({ kind: 'captured', override: captured })
            return null
        }
        return { ...change, desired }
    }

    function compare(leg: Leg, role: LegRole, field: keyof Leg, desired: Value): Change[] {
        const summ = leg[field] as Value
        return same(field, summ, desired) ? [] : [{ leg: role, legId: leg.legId, field, summ, desired }]
    }

    // ---- Managed rows: matched by ID (or through adopted.csv), compared, else uploaded
    const managedRows = input.rows.filter((r) => managedChains.has(r.chain))
    const rowsById = new Map(managedRows.map((r) => [r.id, r]))
    const groups = new Map<string, Leg[]>()
    for (const leg of input.legs.filter((l) => managedSources.has(l.source))) {
        const id = adopted.get(leg.legId) ?? leg.id
        groups.set(id, [...(groups.get(id) ?? []), leg])
    }
    const matched = new Map<string, Leg[]>()
    const legacy: [string, Leg[]][] = []
    let outOfScope = 0
    const deleteGroup = (summId: string, legs: Leg[], row: Row | null, reason: string) => {
        const actionIds = [...new Set(legs.map((l) => l.actionId))]
        const legIds = legs.map((l) => l.legId)
        const others = actionIds.flatMap((a) => legsByAction.get(a) ?? []).filter((l) => !legIds.includes(l.legId))
        plan.delete.push({
            id: row?.id ?? null,
            summId,
            filed: isFiled(row?.timestamp ?? legs[0].timestamp),
            legIds,
            actionIds,
            reason,
            otherLegs: others.length,
        })
    }
    for (const [id, legs] of groups) {
        if (rowsById.has(id)) matched.set(id, legs)
        else if (!legs.some((l) => inScope(l.timestamp))) outOfScope += legs.length
        else if (STABLE_ID.test(id)) deleteGroup(id, legs, null, 'no row in the run')
        else legacy.push([id, legs])
    }

    // Adoption of legs uploaded with an old <file>:<n> ID: the one unmatched row with the same base leg (type,
    // currency, amount, time to the second) and, when the leg's description has txids, the same txids.
    const unmatchedRows = managedRows.filter((r) => !matched.has(r.id))
    const candidates = new Map<string, Row[]>()
    const claims = new Map<string, number>()
    for (const [summId, legs] of legacy) {
        const found = unmatchedRows.filter((row) => {
            const type = typeOf(row)
            const base = legs.filter((l) => l.side === type.side && l.trade === type.trade)
            if (base.length !== 1) return false
            const leg = base[0]
            const txids = legs.flatMap((l) => [...l.description.matchAll(/[0-9a-fA-F]{64}/g)].map((m) => m[0].toLowerCase()))
            return (
                sameCurrency(leg.currency, row.baseCurrency) &&
                sameAmount(leg.quantity, Number(row.baseAmount)) &&
                seconds(leg.timestamp) === seconds(row.timestamp) &&
                txids.every((t) => row.txids.includes(t))
            )
        })
        candidates.set(summId, found)
        for (const row of found) claims.set(row.id, (claims.get(row.id) ?? 0) + 1)
    }
    const heldBack = new Set<string>()
    for (const [summId, legs] of legacy) {
        const found = candidates.get(summId) as Row[]
        if (found.length === 1 && claims.get(found[0].id) === 1) {
            for (const leg of legs) {
                adopted.set(leg.legId, found[0].id)
                plan.adopted.push({ legId: leg.legId, id: found[0].id })
            }
            matched.set(found[0].id, legs)
        } else if (found.length === 0) {
            deleteGroup(summId, legs, null, 'old ID: no row in the run with its txid, time, type, currency and amount')
        } else {
            for (const row of found) heldBack.add(row.id)
            plan.report.push({
                kind: 'ambiguous-adoption',
                filed: isFiled(legs[0].timestamp),
                legIds: legs.map((l) => l.legId),
                detail: `old ID ${summId} fits ${found.length} rows (${found.map((r) => r.id).join(', ')})${found.length === 1 ? ', which other old IDs fit too' : ''}; these rows are not uploaded`,
            })
        }
    }

    // A row whose ID is on legs of a source not in managedSources was uploaded under another account:
    // uploading it again would duplicate it
    const otherSources = new Map<string, Leg[]>()
    for (const leg of input.legs) {
        if (!managedSources.has(leg.source) && rowsById.has(leg.id)) otherSources.set(leg.id, [...(otherSources.get(leg.id) ?? []), leg])
    }

    const toUpload: Row[] = []
    for (const row of managedRows) {
        const legs = matched.get(row.id)
        if (!legs) {
            const elsewhere = otherSources.get(row.id)
            if (elsewhere) {
                const sources = [...new Set(elsewhere.map((l) => l.source))].join(', ')
                plan.report.push({ kind: 'other-source', filed: isFiled(row.timestamp), id: row.id, legIds: elsewhere.map((l) => l.legId), detail: `the row is in Summ under ${sources}, not in managedSources; add the source to summ-sync.json` })
            } else if (!heldBack.has(row.id)) toUpload.push(row)
            continue
        }
        const isAdopted = legs.some((l) => adopted.has(l.legId))
        const shape = shapeOf(row, legs)
        const remake = (reason: string) => {
            deleteGroup(legs[0].id, legs, row, reason)
            toUpload.push(row)
        }
        if (typeof shape === 'string') {
            remake(shape)
            continue
        }
        const { base, quote, fee } = shape
        // An edit cannot set a description, an ID or a currency the MCP does not know (LP tokens), so a row
        // that changed in one of them is deleted and uploaded again. An adopted leg keeps its old wording.
        const currencyChanged =
            !sameCurrency(base.currency, row.baseCurrency) ||
            (quote !== undefined && !sameCurrency(quote.currency, row.quoteCurrency)) ||
            (fee !== undefined && !sameCurrency(fee.currency, row.feeCurrency))
        if (currencyChanged) {
            remake('currency changed')
            continue
        }
        if (!isAdopted && base.description.trim() !== row.description.trim()) {
            remake('description changed')
            continue
        }
        const type = typeOf(row)
        const chain = summBlockchain(row.blockchain)
        if (row.blockchain && !chain) unmappedChains.add(row.blockchain)
        const changes = [
            ...compare(base, 'base', 'trade', type.trade),
            ...compare(base, 'base', 'quantity', Number(row.baseAmount)),
            ...compare(base, 'base', 'timestamp', row.timestamp),
            ...compare(base, 'base', 'from', row.from),
            ...compare(base, 'base', 'to', row.to),
            // Summ infers a blank blockchain from the wallet (docs/specs/assets.md), so only a value it holds is compared
            ...(chain && base.blockchain ? compare(base, 'base', 'blockchain', chain) : []),
            ...(quote ? [...compare(quote, 'quote', 'trade', type.quote as string), ...compare(quote, 'quote', 'quantity', Number(row.quoteAmount))] : []),
            ...(fee ? compare(fee, 'fee', 'quantity', Number(row.feeAmount)) : []),
        ]
            .map((c) => resolve(row.id, base.actionId, c))
            .filter((c): c is Change => c !== null)
        if (changes.length) plan.edit.push({ id: row.id, filed: isFiled(row.timestamp), actionId: base.actionId, changes })
    }

    const uploads = new Map<string, UploadEntry>()
    for (const row of toUpload) {
        const filed = isFiled(row.timestamp)
        const key = `${row.file}|${filed}`
        const entry = uploads.get(key) ?? { file: row.file, filed, ids: [] }
        entry.ids.push(row.id)
        uploads.set(key, entry)
    }
    plan.upload = [...uploads.values()]

    // ---- Categorised rows: Summ's own leg with the row's txid, side and currency, and its amount or the
    // amount plus the fee; only its type and fee are set
    // Summ's own imports, without the legs Summ made up to pair a send as a transfer (soft-transfer)
    const ownLegs = input.legs.filter((l) => !managedSources.has(l.source) && l.importType !== 'manual' && l.importType !== SOFT_TRANSFER)
    const softLegs = input.legs.filter((l) => l.importType === SOFT_TRANSFER && !IGNORED.has(l.trade))
    const legClaims = new Map<string, string[]>()
    const categorised: [Row, Leg][] = []
    for (const row of input.rows.filter((r) => !managedChains.has(r.chain))) {
        const type = typeOf(row)
        const amount = Number(row.baseAmount)
        const gross = amount + (hasFee(row) && sameCurrency(row.feeCurrency, row.baseCurrency) ? Number(row.feeAmount) : 0)
        const found = ownLegs.filter(
            (l) =>
                l.side === type.side &&
                row.txids.includes(normaliseTxid(l.id)) &&
                sameCurrency(l.currency, row.baseCurrency) &&
                (sameAmount(l.quantity, amount) || sameAmount(l.quantity, gross)),
        )
        const filed = isFiled(row.timestamp)
        if (found.length === 1) {
            categorised.push([row, found[0]])
            legClaims.set(found[0].legId, [...(legClaims.get(found[0].legId) ?? []), row.id])
        } else if (found.length > 1) {
            plan.report.push({ kind: 'several-legs', filed, id: row.id, legIds: found.map((l) => l.legId), detail: `${found.length} legs of Summ's imports fit the row` })
        } else if (row.txids.length && !row.txids.some((t) => ownLegs.some((l) => normaliseTxid(l.id) === t)) && row.txids.some((t) => input.txHashes.has(t))) {
            plan.report.push({ kind: 'not-in-snapshot', filed, id: row.id, txids: row.txids, detail: 'Summ lists the txid but the snapshot has no detail for it: pull with the run dir' })
        } else {
            plan.report.push({ kind: 'no-leg', filed, id: row.id, txids: row.txids, detail: row.txids.length ? 'no leg of Summ\'s imports has the row\'s txid, side, currency and amount' : 'the row\'s description has no txid' })
        }
    }
    for (const [row, leg] of categorised) {
        const filed = isFiled(row.timestamp)
        const rowIds = legClaims.get(leg.legId) as string[]
        if (rowIds.length > 1) {
            plan.report.push({ kind: 'leg-claimed-twice', filed, id: row.id, legIds: [leg.legId], detail: `the leg fits rows ${rowIds.join(', ')}` })
            continue
        }
        const changes: Change[] = [...compare(leg, 'base', 'trade', typeOf(row).trade)]
        const feeLegs = (legsByAction.get(leg.actionId) ?? []).filter((l) => l.side === 'fees' && l.id === leg.id)
        if (hasFee(row)) {
            if (feeLegs.length === 1 && sameCurrency(feeLegs[0].currency, row.feeCurrency)) changes.push(...compare(feeLegs[0], 'fee', 'quantity', Number(row.feeAmount)))
            else plan.report.push({ kind: 'fee', filed, id: row.id, legIds: feeLegs.map((l) => l.legId), detail: `the row has a fee of ${row.feeAmount} ${row.feeCurrency}; Summ has ${feeLegs.length} fee legs${feeLegs.length === 1 ? ` in ${feeLegs[0].currency}` : ''}` })
        } else if (feeLegs.some((l) => l.quantity !== 0)) {
            plan.report.push({ kind: 'fee', filed, id: row.id, legIds: feeLegs.map((l) => l.legId), detail: 'the row has no fee; Summ has a fee leg' })
        }
        const resolved = changes.map((c) => resolve(row.id, leg.actionId, c)).filter((c): c is Change => c !== null)
        // A row that is not a plain send or receive leaves Summ's made-up other side of the transfer counted
        // on its own once categorised: it is ignored
        const trade = typeOf(row).trade
        const ignore =
            trade === 'withdrawal' || trade === 'deposit'
                ? []
                : softLegs.filter((l) => row.txids.includes(normaliseTxid(l.id)) && sameCurrency(l.currency, leg.currency)).map((l) => l.legId)
        if (resolved.length || ignore.length) {
            plan.categorise.push({ id: row.id, filed, actionId: leg.actionId, changes: resolved, ...(ignore.length ? { ignore } : {}) })
        }
    }

    // ---- Manual entries repeating a row's txid
    const txidRows = new Map<string, string>()
    for (const row of input.rows) for (const t of row.txids) txidRows.set(t, row.id)
    for (const leg of input.legs.filter((l) => l.importType === 'manual')) {
        const text = [leg.description, ...leg.comments].join(' ')
        for (const m of text.matchAll(/[0-9a-fA-F]{64}/g)) {
            const id = txidRows.get(m[0].toLowerCase())
            if (id) plan.report.push({ kind: 'manual-entry', filed: isFiled(leg.timestamp), id, legIds: [leg.legId], txids: [m[0].toLowerCase()], detail: 'a manual entry names the row\'s txid' })
        }
    }

    // ---- Overrides whose row is gone from the run
    const runIds = new Set(input.rows.map((r) => r.id))
    for (const override of overrides) if (!runIds.has(override.id)) plan.overridden.push({ kind: 'gone', override })

    if (unmappedChains.size) plan.notes.push(`Blockchain not compared (no Summ id in src/summ-types.ts): ${[...unmappedChains].join(', ')}`)
    plan.counts = {
        rows: input.rows.length,
        managedRows: managedRows.length,
        categorisedRows: input.rows.length - managedRows.length,
        managedLegs: input.legs.filter((l) => managedSources.has(l.source)).length,
        managedLegsOutOfScope: outOfScope,
        matchedRows: matched.size,
        adoptedLegs: plan.adopted.length,
        deletes: plan.delete.length,
        edits: plan.edit.length,
        uploads: toUpload.length,
        categorise: plan.categorise.length,
        reports: plan.report.length,
        overridden: plan.overridden.length,
    }
    return { plan, adopted, overrides }
}
