// prune: removes snapshot files other than the latest `keep`, and action store files that none of the kept
// snapshots lists, but only files git holds as committed (spec: docs/specs/summ-sync.md, State dir).

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

export function prune(stateDir: string, keep = 3): PruneResult {
    if (!Number.isInteger(keep) || keep < 1) throw new Error('--keep must be a whole number of at least 1')
    const names = snapshotNames(stateDir)
    const kept = names.slice(-keep)
    const listed = new Set(kept.flatMap((n) => readSnapshotFile(join(stateDir, 'snapshots', `${n}.json`)).actions.map((a) => a.id)))
    const actionsDir = join(stateDir, 'actions')
    const candidates = [
        ...names.slice(0, -keep).map((n) => `snapshots/${n}.json`),
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

export function runPrune(stateDir: string, keep?: number): void {
    const { removed, uncommitted } = prune(stateDir, keep)
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
