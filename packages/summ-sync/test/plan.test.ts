import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, type Config } from '../src/config.ts'
import { makePlan, type PlanInput } from '../src/plan.ts'
import type { Row, RunFile } from '../src/run.ts'
import type { Leg } from '../src/snapshot.ts'
import type { Override } from '../src/state.ts'
import { renderPlan, uploadFiles } from '../src/write-plan.ts'

// Every value below is made up.
const PERIOD = { from: '2023-07-01', to: '2024-06-30' }
const THOR_FILE = '2023-07-01_2024-06-30_THOR_abcde_Example.csv'
const BTC_FILE = '2023-07-01_2024-06-30_BTC_fghij_Example.csv'
const FILES: RunFile[] = [
    { name: THOR_FILE, chain: 'THOR', period: PERIOD, header: 'HEADER' },
    { name: BTC_FILE, chain: 'BTC', period: PERIOD, header: 'HEADER' },
]
const CONFIG: Config = { ...DEFAULTS, managedSources: ['csv-source'] }
const TX1 = '1'.repeat(64)
const TX2 = '2'.repeat(64)

let next = 0
const legId = () => `leg${String(++next).padStart(4, '0')}`

function row(over: Partial<Row> = {}): Row {
    const r: Row = {
        file: THOR_FILE,
        chain: 'THOR',
        line: '',
        id: '2024-03-01T10:00:00.000Z.out.aaaaaaaaaaaa',
        timestamp: '2024-03-01T10:00:00.000Z',
        type: 'send',
        baseCurrency: 'RUNE',
        baseAmount: '1.5',
        quoteCurrency: '',
        quoteAmount: '',
        feeCurrency: '',
        feeAmount: '',
        from: 'wallet-a',
        to: 'wallet-b',
        blockchain: 'THORChain',
        description: `Sent 1.5 RUNE; ${TX1}`,
        txids: [TX1],
        ...over,
    }
    r.line = `${r.timestamp},${r.type},${r.id}`
    return r
}

/** The legs Summ makes of a managed row: base, quote of a trade, fee. */
function legsOf(r: Row, over: Partial<Leg> = {}, actionId = 'action1'): Leg[] {
    const common = { actionId, id: r.id, timestamp: r.timestamp, from: r.from, to: r.to, blockchain: 'thorchain', description: r.description, source: 'csv-source', importType: 'manual-csv', comments: [] }
    const sides: Record<string, ['incoming' | 'outgoing', string]> = {
        send: ['outgoing', 'withdrawal'],
        receive: ['incoming', 'deposit'],
        sell: ['outgoing', 'sell'],
        staking: ['incoming', 'staking'],
    }
    const [side, trade] = sides[r.type]
    const legs: Leg[] = [{ ...common, legId: legId(), side, trade, currency: r.baseCurrency, quantity: Number(r.baseAmount), ...over }]
    if (r.quoteCurrency) legs.push({ ...common, legId: legId(), side: side === 'incoming' ? 'outgoing' : 'incoming', trade: 'buy', currency: r.quoteCurrency, quantity: Number(r.quoteAmount) })
    if (r.feeAmount) legs.push({ ...common, legId: legId(), side: 'fees', trade: 'fee', currency: r.feeCurrency, quantity: Number(r.feeAmount) })
    return legs
}

function plan(over: Partial<PlanInput>) {
    return makePlan({
        files: FILES,
        rows: [],
        legs: [],
        history: new Map(),
        txHashes: new Set(),
        config: CONFIG,
        adopted: new Map(),
        overrides: [],
        applyLog: [],
        now: '2024-08-01T00:00:00.000Z',
        ...over,
    })
}

const empty = (p: ReturnType<typeof plan>['plan']) => [p.delete, p.edit, p.upload, p.categorise, p.report, p.overridden].every((s) => s.length === 0)

test('a row Summ holds as the run has it plans nothing', () => {
    const r = row({ feeCurrency: 'RUNE', feeAmount: '0.02' })
    const { plan: p } = plan({ rows: [r], legs: legsOf(r) })
    assert.ok(empty(p), JSON.stringify(p, null, 1))
    assert.equal(p.counts.matchedRows, 1)
})

test('a trade compares its quote leg; amounts within 1e-8 of the amount or at the 8th decimal are equal', () => {
    const r = row({ type: 'sell', quoteCurrency: 'BTC', quoteAmount: '0.001' })
    const legs = legsOf(r)
    legs[0].quantity = 1.5 * (1 + 1e-10)
    assert.ok(empty(plan({ rows: [r], legs }).plan))
    legs[1].quantity = 0.00100000999
    assert.ok(empty(plan({ rows: [r], legs }).plan))
    legs[1].quantity = 0.002
    const { plan: p } = plan({ rows: [r], legs })
    assert.deepEqual(p.edit[0].changes.map((c) => [c.leg, c.field, c.summ, c.desired]), [['quote', 'quantity', 0.002, 0.001]])
})

test('a changed amount, type or time is an edit of the leg', () => {
    const r = row({ type: 'receive', baseAmount: '2' })
    const legs = legsOf(row({ type: 'receive' }), { trade: 'staking', timestamp: '2024-03-01T10:00:00.900Z' })
    const { plan: p } = plan({ rows: [r], legs })
    assert.equal(p.edit.length, 1)
    assert.deepEqual(p.edit[0].changes.map((c) => [c.field, c.summ, c.desired]), [['trade', 'staking', 'deposit'], ['quantity', 1.5, 2]])
    assert.equal(p.edit[0].changes[0].legId, legs[0].legId)
})

test('a blank blockchain in Summ is not compared (Summ infers it from the wallet); another chain is', () => {
    const r = row()
    assert.ok(empty(plan({ rows: [r], legs: legsOf(r, { blockchain: '' }) }).plan))
    const { plan: p } = plan({ rows: [r], legs: legsOf(r, { blockchain: 'btc' }) })
    assert.deepEqual(p.edit[0].changes.map((c) => [c.field, c.summ, c.desired]), [['blockchain', 'btc', 'thorchain']])
})

test('a categorised row matches a leg whose hash carries an output index', () => {
    const r = btcRow({ type: 'bridge-trade-out' })
    const { plan: p } = plan({ rows: [r], legs: [ownLeg({ id: `${TX1}__1` })] })
    assert.equal(p.categorise.length, 1)
})

test('a changed description, currency or shape deletes the legs and uploads the row', () => {
    const r = row({ feeCurrency: 'RUNE', feeAmount: '0.02' })
    for (const [legs, reason] of [
        [legsOf(r, { description: 'Old wording' }), /description/],
        [legsOf(r, { currency: 'ETH' }), /currency/],
        [legsOf(row()), /shape/],
    ] as const) {
        const { plan: p } = plan({ rows: [r], legs: [...legs] })
        assert.equal(p.delete.length, 1)
        assert.match(p.delete[0].reason, reason)
        assert.deepEqual(p.delete[0].legIds, legs.map((l) => l.legId))
        assert.deepEqual(p.upload, [{ file: THOR_FILE, filed: false, ids: [r.id] }])
        assert.equal(p.edit.length, 0)
    }
})

test('a row Summ lacks is uploaded, filed years apart, with the file header and its line', () => {
    const now = row()
    const old = row({ id: '2023-08-01T00:00:00.000Z.out.bbbbbbbbbbbb', timestamp: '2023-08-01T00:00:00.000Z' })
    const { plan: p } = plan({ rows: [now, old], config: { ...CONFIG, filedBefore: '2024-01-01' } })
    assert.deepEqual(p.upload, [
        { file: THOR_FILE, filed: false, ids: [now.id] },
        { file: THOR_FILE, filed: true, ids: [old.id] },
    ])
    const files = uploadFiles(p, FILES, [now, old])
    assert.deepEqual(files.map((f) => f.name), [THOR_FILE, THOR_FILE.replace('.csv', '_filed.csv')])
    assert.equal(files[0].text, `HEADER\n${now.line}\n`)
})

test('a leg with no row is deleted only inside the run\'s periods', () => {
    const gone = legsOf(row({ id: '2024-02-01T00:00:00.000Z.in.cccccccccccc', timestamp: '2024-02-01T00:00:00.000Z' }))
    const earlier = legsOf(row({ id: '2022-02-01T00:00:00.000Z.in.dddddddddddd', timestamp: '2022-02-01T00:00:00.000Z' }))
    const earlierLegacy = legsOf(row({ id: 'old-file.csv:3', timestamp: '2022-02-01T00:00:00.000Z' }))
    const { plan: p } = plan({ legs: [...gone, ...earlier, ...earlierLegacy] })
    assert.deepEqual(p.delete.map((d) => [d.summId, d.reason]), [['2024-02-01T00:00:00.000Z.in.cccccccccccc', 'no row in the run']])
    assert.equal(p.counts.managedLegsOutOfScope, 2)
})

test('a delete counts the other legs in its actions', () => {
    const gone = legsOf(row({ id: '2024-02-01T00:00:00.000Z.in.cccccccccccc' }), {}, 'shared')
    const other: Leg = { ...gone[0], legId: legId(), side: 'incoming', id: TX1, source: 'btc-wallet', importType: 'wallet' }
    const { plan: p } = plan({ legs: [...gone, other] })
    assert.equal(p.delete[0].otherLegs, 1)
})

test('an old <file>:<n> leg is adopted to the one row with its time, type, currency, amount and txid', () => {
    const r = row({ description: `New wording; ${TX1}` })
    const legs = legsOf(r, { id: 'old-file.csv:7', description: `Old wording; ${TX1.toUpperCase()}` })
    const first = plan({ rows: [r], legs })
    assert.deepEqual(first.plan.adopted, [{ legId: legs[0].legId, id: r.id }])
    assert.ok(empty(first.plan), JSON.stringify(first.plan, null, 1))
    assert.equal(first.adopted.get(legs[0].legId), r.id)

    // Next plan: matched through adopted.csv; a later amount change is an edit, not a re-upload
    const second = plan({ rows: [{ ...r, baseAmount: '1.6' }], legs, adopted: first.adopted })
    assert.deepEqual(second.plan.adopted, [])
    assert.deepEqual(second.plan.edit[0].changes.map((c) => c.field), ['quantity'])
})

test('an old leg with another txid, or none of the row\'s values, is deleted and the row uploaded', () => {
    const r = row()
    for (const over of [{ description: `Old; ${TX2}` }, { quantity: 9 }]) {
        const { plan: p } = plan({ rows: [r], legs: legsOf(r, { id: 'old-file.csv:7', ...over }) })
        assert.equal(p.adopted.length, 0)
        assert.match(p.delete[0].reason, /old ID/)
        assert.deepEqual(p.upload[0].ids, [r.id])
    }
})

test('an old leg that fits two rows is reported, and neither row is uploaded', () => {
    const a = row({ description: 'no txid' })
    const b = row({ id: '2024-03-01T10:00:00.000Z.out.eeeeeeeeeeee', description: 'no txid either' })
    const { plan: p } = plan({ rows: [a, b], legs: legsOf(a, { id: 'old-file.csv:7', description: '' }) })
    assert.equal(p.report[0].kind, 'ambiguous-adoption')
    assert.deepEqual(p.upload, [])
    assert.deepEqual(p.delete, [])
})

test('a field the user changed in Summ is captured as an override and kept', () => {
    const r = row()
    const legs = legsOf(r, { trade: 'outgoingGift' })
    const history = new Map([['action1', ['1 Jan 2024 · import (original)', '2 Jan 2024 · user · Category: Send → Outgoing Gift']]])
    const first = plan({ rows: [r], legs, history })
    assert.deepEqual(first.plan.edit, [])
    assert.deepEqual(first.plan.overridden.map((o) => [o.kind, o.override.field, o.override.run, o.override.summ]), [['captured', 'trade', 'withdrawal', 'outgoingGift']])

    // Kept on the next plan, and listed again only when the run's value moves under it
    const overrides = first.overrides
    assert.ok(empty(plan({ rows: [r], legs, history, overrides }).plan))
    const moved = plan({ rows: [{ ...r, type: 'receive' }], legs: legsOf(r, { side: 'incoming', trade: 'outgoingGift' }), history, overrides })
    assert.deepEqual(moved.plan.overridden.map((o) => [o.kind, o.runNow]), [['run-changed', 'deposit']])
    assert.deepEqual(moved.plan.edit, [])
})

test('deleting an override reverts the field; an edit apply-log records is the sync\'s own', () => {
    const r = row()
    const legs = legsOf(r, { trade: 'outgoingGift' })
    const history = new Map([['action1', ['2 Jan 2024 · user · Category: Send → Outgoing Gift']]])
    const { plan: p } = plan({ rows: [r], legs, history, applyLog: [{ legId: legs[0].legId, field: 'trade', value: 'outgoingGift' }] })
    assert.deepEqual(p.edit[0].changes.map((c) => [c.field, c.desired]), [['trade', 'withdrawal']])
    assert.deepEqual(p.overridden, [])
})

test('an override whose row left the run is listed as gone', () => {
    const override: Override = { id: 'gone-id', leg: 'base', field: 'trade', run: 'a', summ: 'b', seenAt: '', reason: '' }
    const { plan: p } = plan({ overrides: [override] })
    assert.deepEqual(p.overridden.map((o) => o.kind), ['gone'])
})

function btcRow(over: Partial<Row> = {}): Row {
    return row({ file: BTC_FILE, chain: 'BTC', id: '2024-03-01T10:00:00.000Z.in.ffffffffffff', type: 'send', baseCurrency: 'BTC', baseAmount: '0.01', feeCurrency: 'BTC', feeAmount: '0.0001', blockchain: 'BTC', ...over })
}

function ownLeg(over: Partial<Leg> = {}): Leg {
    return { legId: legId(), actionId: 'l1', side: 'outgoing', id: TX1, trade: 'withdrawal', currency: 'BTC', quantity: 0.0101, timestamp: '2024-03-01T10:00:00.000Z', from: '', to: '', blockchain: 'btc', description: '', source: 'btc-wallet', importType: 'wallet', comments: [], ...over }
}

test('a categorised row sets the type and fee of Summ\'s own leg with its txid, currency and gross amount', () => {
    const r = btcRow({ type: 'bridge-trade-out' })
    const leg = ownLeg()
    const fee = ownLeg({ side: 'fees', trade: 'fee', quantity: 0.0002 })
    const { plan: p } = plan({ rows: [r], legs: [leg, fee] })
    assert.equal(p.categorise.length, 1)
    assert.deepEqual(p.categorise[0].changes.map((c) => [c.leg, c.field, c.desired]), [['base', 'trade', 'bridgeTradeOut'], ['fee', 'quantity', 0.0001]])
    assert.equal(p.upload.length, 0)
})

test('the receive Summ made up to pair a categorised send as a transfer is ignored, never matched', () => {
    const made = (over: Partial<Leg> = {}) => ownLeg({ side: 'incoming', trade: 'deposit', quantity: 0.0101, source: 'manual', importType: 'soft-transfer', to: 'THORChain', ...over })
    const fee = () => ownLeg({ side: 'fees', trade: 'fee', quantity: 0.0001 })
    // in the send's action, before the send is categorised
    const soft = made()
    const before = plan({ rows: [btcRow({ type: 'bridge-trade-out' })], legs: [ownLeg(), fee(), soft] }).plan
    assert.deepEqual(before.categorise.map((e) => [e.changes.map((c) => c.desired), e.ignore]), [[['bridgeTradeOut'], [soft.legId]]])
    // left on its own after the send was categorised: ignored without an edit
    const alone = made({ actionId: 'l2' })
    const after = plan({ rows: [btcRow({ type: 'bridge-trade-out' })], legs: [ownLeg({ trade: 'bridgeTradeOut' }), fee(), alone] }).plan
    assert.deepEqual(after.categorise.map((e) => [e.changes, e.ignore]), [[[], [alone.legId]]])
    // already ignored, or the row is a plain send (Summ's transfer is right): nothing to do
    assert.deepEqual(plan({ rows: [btcRow({ type: 'bridge-trade-out' })], legs: [ownLeg({ trade: 'bridgeTradeOut' }), fee(), made({ trade: 'ignoreIn' })] }).plan.categorise, [])
    assert.deepEqual(plan({ rows: [btcRow()], legs: [ownLeg(), fee(), made()] }).plan.categorise, [])
    // a categorised receive is never matched to a made-up leg of the same amount
    const receive = btcRow({ type: 'bridge-trade-in', feeCurrency: '', feeAmount: '' })
    const own = ownLeg({ side: 'incoming', trade: 'deposit', quantity: 0.01 })
    const p = plan({ rows: [receive], legs: [own, made({ quantity: 0.01 })] }).plan
    assert.deepEqual([p.report, p.categorise.map((e) => e.changes[0].legId)], [[], [own.legId]])
})

test('the send Summ made up to pair a categorised receive as a transfer is ignored', () => {
    const receive = btcRow({ type: 'bridge-trade-in', feeCurrency: '', feeAmount: '' })
    const own = ownLeg({ side: 'incoming', trade: 'deposit', quantity: 0.01 })
    const made = ownLeg({ side: 'outgoing', trade: 'withdrawal', quantity: 0.01, source: 'manual', importType: 'soft-transfer', from: 'THORChain' })
    const p = plan({ rows: [receive], legs: [own, made] }).plan
    assert.deepEqual(p.categorise.map((e) => [e.changes.map((c) => [c.legId, c.desired]), e.ignore]), [[[[own.legId, 'bridgeTradeIn']], [made.legId]]])
    assert.deepEqual(p.report, [])
})

test('a categorised row with no or several fitting legs is reported, never guessed', () => {
    const r = btcRow()
    const none = plan({ rows: [r], legs: [ownLeg({ id: TX2 })] }).plan
    assert.deepEqual(none.report.map((e) => e.kind), ['no-leg'])
    const unfetched = plan({ rows: [r], legs: [], txHashes: new Set([TX1]) }).plan
    assert.deepEqual(unfetched.report.map((e) => e.kind), ['not-in-snapshot'])
    const several = plan({ rows: [r], legs: [ownLeg(), ownLeg({ quantity: 0.01 })] }).plan
    assert.deepEqual(several.report.map((e) => e.kind), ['several-legs'])
    assert.deepEqual(several.categorise, [])
})

test('a manual entry naming a row\'s txid is reported', () => {
    const r = row()
    const manual = ownLeg({ importType: 'manual', source: 'manual', id: 'x-manual', comments: [`see ${TX1}`] })
    const { plan: p } = plan({ rows: [r], legs: [...legsOf(r), manual] })
    assert.deepEqual(p.report.map((e) => [e.kind, e.id]), [['manual-entry', r.id]])
})

test('a row uploaded under a source not in managedSources is reported, not uploaded again', () => {
    const r = row()
    const { plan: p } = plan({ rows: [r], legs: legsOf(r, { source: 'other-account' }) })
    assert.deepEqual(p.report.map((e) => e.kind), ['other-source'])
    assert.deepEqual(p.upload, [])
})

test('a CSV type with no Summ type stops the plan', () => {
    assert.throws(() => plan({ rows: [row({ type: 'teleport' })] }), /No Summ type for CSV type teleport/)
})

test('plan.md lists each section and keeps filed entries apart', () => {
    const { plan: p } = plan({ rows: [row(), row({ id: '2023-08-01T00:00:00.000Z.out.bbbbbbbbbbbb', timestamp: '2023-08-01T00:00:00.000Z' })], config: { ...CONFIG, filedBefore: '2024-01-01' } })
    const md = renderPlan(p, 'snap', 'run')
    for (const heading of ['## Delete', '## Edit', '## Upload (', '## Categorise', '## Report', '## Overridden', '### Amendments']) assert.ok(md.includes(heading), heading)
})
