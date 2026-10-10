// migrate (one-off): the old snapshot folders to the action store and snapshot files (spec:
// docs/specs/summ-sync.md, State dir). Reads
//
//   snapshots/<time>/   actions.jsonl, details/<action id>.json (or .md: inspect_transaction's text, as the
//                       first version wrote it), manifest.json
//   deleted/<time>/     <action id>.json, saved by apply before a delete
//
// and writes actions/<action id>.json (the first copy of each id) and snapshots/<time>.json. Reports each id
// whose copies differ in what the sync reads. The old folders are left for the user to remove.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { type ActionDetail, type ListedAction, parseDetail } from './parse.ts'
import { snapshotEntry } from './pull.ts'
import { readAction, storeAction, syncView, writeSnapshot } from './snapshot.ts'

export interface MigrateResult {
    snapshots: string[]
    /** Old folders whose snapshot file exists already. */
    skipped: string[]
    stored: number
    /** Ids stored with different legs or history entries in another copy: the first copy is kept. */
    differs: { id: string; from: string }[]
}

const folders = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory()).sort() : [])

export function migrate(stateDir: string): MigrateResult {
    const result: MigrateResult = { snapshots: [], skipped: [], stored: 0, differs: [] }
    const keep = (detail: ActionDetail, from: string) => {
        const before = readAction(stateDir, detail.action._id)
        if (!before) {
            storeAction(stateDir, detail)
            result.stored++
        } else if (syncView(before) !== syncView(detail)) result.differs.push({ id: detail.action._id, from })
    }
    const readDetails = (dir: string, from: string): string[] =>
        readdirSync(dir)
            .filter((f) => /\.(json|md)$/.test(f))
            .sort()
            .map((f) => {
                const text = readFileSync(join(dir, f), 'utf8')
                keep(f.endsWith('.md') ? parseDetail(text) : JSON.parse(text), from)
                return f.replace(/\.(json|md)$/, '')
            })

    const snapshotsDir = join(stateDir, 'snapshots')
    for (const name of folders(snapshotsDir).filter((n) => existsSync(join(snapshotsDir, n, 'manifest.json')))) {
        if (existsSync(join(snapshotsDir, `${name}.json`))) {
            result.skipped.push(name)
            continue
        }
        const dir = join(snapshotsDir, name)
        const details = new Set(existsSync(join(dir, 'details')) ? readDetails(join(dir, 'details'), `snapshots/${name}`) : [])
        const listed: ListedAction[] = readFileSync(join(dir, 'actions.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
        const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
        writeSnapshot(join(snapshotsDir, `${name}.json`), {
            ...manifest,
            migratedFrom: `snapshots/${name}/`,
            actions: listed.map((a) => ({ ...snapshotEntry(a), ...(details.has(a['Action ID'] as string) ? { detail: true as const } : {}) })),
        })
        result.snapshots.push(name)
    }
    const deletedDir = join(stateDir, 'deleted')
    for (const name of folders(deletedDir)) readDetails(join(deletedDir, name), `deleted/${name}`)
    return result
}

export function runMigrate(stateDir: string): void {
    const { snapshots, skipped, stored, differs } = migrate(stateDir)
    console.log(`Migrated ${snapshots.length} snapshots (${skipped.length} already done); ${stored} actions stored`)
    if (differs.length) {
        console.log(`WARNING: ${differs.length} copies differ from the stored action with the same id (the first copy is kept):`)
        for (const d of differs) console.log(`  ${d.id} in ${d.from}`)
    }
    if (snapshots.length) console.log('Plan again, compare with a plan from before, then remove the old folders (snapshots/<time>/, deleted/).')
}
