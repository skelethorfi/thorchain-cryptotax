// The plan command: reads the run, the latest snapshot and the state tables, and writes
//
//   <state dir>/plans/<timestamp>/plan.json        the plan (input to apply)
//   <state dir>/plans/<timestamp>/plan.md          the same, for review
//   <state dir>/plans/<timestamp>/upload/<file>    per CSV file, the rows Summ lacks, for the user to upload
//   <state dir>/adopted.csv, overrides.json        with the adoptions and overrides this plan captured

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { extraDirsOf, loadConfig } from './config.ts'
import { type Change, makePlan, type EditEntry, type Plan } from './plan.ts'
import { readRun, type Row, type RunFile } from './run.ts'
import { latestSnapshot, readSnapshot } from './snapshot.ts'
import { readAdopted, readApplyLog, readOverrides, writeAdopted, writeOverrides } from './state.ts'

const show = (v: unknown) => (v === null || v === '' || v === undefined ? '–' : String(v))
const cell = (v: unknown) => show(v).replaceAll('|', '\\|')

function changeLines(entries: EditEntry[]): string[] {
    return entries.flatMap((e) => [
        ...e.changes.map((c: Change) => `| ${e.id} | ${c.leg} \`${c.legId}\` | ${c.field} | ${cell(c.summ)} | ${cell(c.desired)} |`),
        ...(e.ignore ?? []).map((legId) => `| ${e.id} | made-up leg \`${legId}\` | – | transfer | ignored |`),
    ])
}

function section<T extends { filed: boolean }>(title: string, entries: T[], render: (entries: T[]) => string[]): string[] {
    const out = [`## ${title} (${entries.length})`, '']
    for (const [label, part] of [
        ['', entries.filter((e) => !e.filed)],
        ['### Amendments (filed years): apply only with --approve-filed', entries.filter((e) => e.filed)],
    ] as const) {
        if (part.length === 0) continue
        if (label) out.push(label, '')
        out.push(...render(part as T[]), '')
    }
    if (entries.length === 0) out.push('None.', '')
    return out
}

export function renderPlan(plan: Plan, snapshot: string, run: string): string {
    const lines = [
        '# Summ sync plan',
        '',
        `- Created: ${plan.createdAt}`,
        `- Snapshot: ${snapshot}`,
        `- Run: ${run}`,
        `- Periods: ${plan.periods.map((p) => `${p.from} to ${p.to}`).join(', ')} (${plan.timezone})`,
        `- Managed chains: ${plan.managedChains.join(', ')}; sources: ${plan.managedSources.join(', ') || '–'}; filed before: ${show(plan.filedBefore)}`,
        '',
        '## Counts',
        '',
        ...Object.entries(plan.counts).map(([k, v]) => `- ${k}: ${v}`),
        ...plan.notes.map((n) => `- Note: ${n}`),
        '',
        ...section('Delete (only with --approve-deletes)', plan.delete, (es) => [
            '| Row | ID in Summ | Legs | Other legs in the actions | Reason |',
            '| --- | --- | --- | --- | --- |',
            ...es.map((e) => `| ${show(e.id)} | ${cell(e.summId)} | ${e.legIds.length} | ${e.otherLegs} | ${cell(e.reason)} |`),
        ]),
        ...section('Edit', plan.edit, (es) => ['| Row | Leg | Field | Summ | Desired |', '| --- | --- | --- | --- | --- |', ...changeLines(es)]),
        ...section('Upload (files in upload/, uploaded by you)', plan.upload, (es) => es.map((e) => `- ${e.file}: ${e.ids.length} rows`)),
        ...section('Categorise', plan.categorise, (es) => ['| Row | Leg | Field | Summ | Desired |', '| --- | --- | --- | --- | --- |', ...changeLines(es)]),
        ...section('Report (for you to resolve)', plan.report, (es) => [
            '| Kind | Row | Legs | Detail |',
            '| --- | --- | --- | --- |',
            ...es.map((e) => `| ${e.kind} | ${show(e.id)} | ${(e.legIds ?? []).join(' ') || '–'} | ${cell(e.detail)} |`),
        ]),
        ...section(
            'Overridden (kept as you set them in Summ)',
            plan.overridden.map((o) => ({ ...o, filed: false })),
            (es) => [
                '| Kind | Row | Leg | Field | Run | Yours | Run now |',
                '| --- | --- | --- | --- | --- | --- | --- |',
                ...es.map((o) => `| ${o.kind} | ${o.override.id} | ${o.override.leg} | ${o.override.field} | ${cell(o.override.run)} | ${cell(o.override.summ)} | ${cell(o.runNow)} |`),
            ],
        ),
    ]
    return lines.join('\n')
}

/** Upload files: per CSV file (and filed or not), its header and the rows Summ lacks, in the file's order. */
export function uploadFiles(plan: Plan, files: RunFile[], rows: Row[]): { name: string; text: string }[] {
    const byId = new Map(rows.map((r) => [r.id, r]))
    return plan.upload.map((u) => {
        const header = (files.find((f) => f.name === u.file) as RunFile).header
        const name = u.filed ? u.file.replace(/\.csv$/, '_filed.csv') : u.file
        return { name, text: [header, ...u.ids.map((id) => (byId.get(id) as Row).line)].join('\n') + '\n' }
    })
}

export function writePlan(stateDir: string, runDir: string): string {
    const config = loadConfig(stateDir)
    const snapshotDir = latestSnapshot(stateDir)
    const snapshot = readSnapshot(snapshotDir)
    const { files, rows } = readRun(runDir, extraDirsOf(stateDir, config))
    const now = new Date().toISOString()
    const { plan, adopted, overrides } = makePlan({
        files,
        rows,
        legs: snapshot.legs,
        history: snapshot.history,
        txHashes: snapshot.txHashes,
        config,
        adopted: readAdopted(stateDir),
        overrides: readOverrides(stateDir),
        applyLog: readApplyLog(stateDir),
        now,
    })

    const dir = join(stateDir, 'plans', now.slice(0, 19).replace(/:/g, '-'))
    mkdirSync(join(dir, 'upload'), { recursive: true })
    writeFileSync(join(dir, 'plan.json'), JSON.stringify({ snapshot: snapshot.name, run: resolve(runDir), ...plan }, null, 2) + '\n')
    writeFileSync(join(dir, 'plan.md'), renderPlan(plan, snapshot.name, resolve(runDir)) + '\n')
    for (const file of uploadFiles(plan, files, rows)) writeFileSync(join(dir, 'upload', file.name), file.text)
    if (plan.adopted.length) writeAdopted(stateDir, adopted)
    if (plan.overridden.some((o) => o.kind === 'captured')) writeOverrides(stateDir, overrides)

    console.log(Object.entries(plan.counts).map(([k, v]) => `${k}: ${v}`).join(', '))
    console.log(`Plan written to ${dir}`)
    return dir
}
