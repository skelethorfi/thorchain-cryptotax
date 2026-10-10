// prune: removes snapshot files older than `days` (never the latest), and action store files that no remaining
// snapshot lists, but only files git holds as committed (spec: docs/specs/summ-sync.md, State dir).

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readSnapshotFile, snapshotNames } from './snapshot.ts'

const git = (stateDir: string, args: string[]): string[] =>
    execFileSync('git', ['-C', stateDir, ...args], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean)

export interface PruneResult {
    removed: string[]
    /** Files that would be removed but are not committed: nothing is removed while there are any. */
    uncommitted: string[]
}

/** A snapshot's time, from its name (`2024-01-02T03-04-05`, UTC). */
export const snapshotTime = (name: string): number => Date.parse(`${name.replace(/T(\d\d)-(\d\d)-(\d\d)$/, 'T$1:$2:$3')}Z`)

export function prune(stateDir: string, days = 30, now = Date.now()): PruneResult {
    if (!(days >= 0)) throw new Error('--older-than must be a number of days')
    const names = snapshotNames(stateDir)
    const cutoff = now - days * 86_400_000
    const old = names.slice(0, -1).filter((n) => snapshotTime(n) < cutoff)
    const kept = names.filter((n) => !old.includes(n))
    const listed = new Set(kept.flatMap((n) => readSnapshotFile(join(stateDir, 'snapshots', `${n}.json`)).actions.map((a) => a.id)))
    const actionsDir = join(stateDir, 'actions')
    const candidates = [
        ...old.map((n) => `snapshots/${n}.json`),
        ...(existsSync(actionsDir) ? readdirSync(actionsDir) : []).filter((f) => !listed.has(f.replace(/\.json$/, ''))).map((f) => `actions/${f}`),
    ]
    if (candidates.length === 0) return { removed: [], uncommitted: [] }

    // Paths relative to the state dir: committed in HEAD, and unchanged since (staged or not)
    const committed = new Set(git(stateDir, ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', 'snapshots', 'actions']))
    const changed = new Set(git(stateDir, ['diff', '-z', '--name-only', '--relative', 'HEAD', '--', 'snapshots', 'actions']))
    const uncommitted = candidates.filter((f) => !committed.has(f) || changed.has(f))
    if (uncommitted.length) return { removed: [], uncommitted }
    for (const f of candidates) unlinkSync(join(stateDir, f))
    return { removed: candidates, uncommitted: [] }
}

export function runPrune(stateDir: string, days?: number): void {
    const { removed, uncommitted } = prune(stateDir, days)
    if (uncommitted.length) {
        console.log(`Removed nothing: ${uncommitted.length} files to prune are not committed (commit them first):`)
        for (const f of uncommitted.slice(0, 20)) console.log(`  ${f}`)
        if (uncommitted.length > 20) console.log(`  ... and ${uncommitted.length - 20} more`)
        process.exitCode = 1
        return
    }
    const snapshots = removed.filter((f) => f.startsWith('snapshots/')).length
    console.log(`Removed ${snapshots} snapshots and ${removed.length - snapshots} stored actions (git keeps them; commit the removal)`)
}
