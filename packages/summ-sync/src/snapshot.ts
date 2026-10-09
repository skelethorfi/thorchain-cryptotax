// A snapshot written by pull, read as legs: each incoming, outgoing and fee leg of every action with full
// detail, plus the tx hashes of every listed action.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActionDetail } from './parse.ts'

export type LegSide = 'incoming' | 'outgoing' | 'fees'

export interface Leg {
    /** The leg's database id: stable across edits. */
    legId: string
    /** The action's id: changes on every write. */
    actionId: string
    side: LegSide
    /** Summ's "Tx Hash": the CSV row's ID, or the on-chain txid of Summ's own imports. */
    id: string
    trade: string
    currency: string
    quantity: number
    timestamp: string
    from: string
    to: string
    blockchain: string
    description: string
    source: string
    importType: string
    comments: string[]
}

export interface Snapshot {
    name: string
    legs: Leg[]
    /** Change history of each action with full detail. */
    history: Map<string, string[]>
    /** Every listed action's tx hash, lower case without 0x. */
    txHashes: Set<string>
}

const SIDES: LegSide[] = ['incoming', 'outgoing', 'fees']

/** A tx hash as plan compares it: lower case, without 0x, and without the output index some imports append
 * (`<hash>__1`, `<hash>-0`). */
export function normaliseTxid(txid: string): string {
    const hex = txid.match(/^(?:0x)?([0-9a-fA-F]{64})(?:(?:__|-)\d+)?$/)
    return hex ? hex[1].toLowerCase() : txid.toLowerCase().replace(/^0x/, '')
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function legsOf(detail: ActionDetail): Leg[] {
    const action = detail.action
    return SIDES.flatMap((side) =>
        ((action[side] as Record<string, unknown>[] | undefined) ?? []).map((leg) => ({
            legId: text(leg._id),
            actionId: action._id,
            side,
            id: text(leg.id),
            trade: text(leg.trade),
            currency: text((leg.currencyIdentifier as { symbol?: string } | undefined)?.symbol) || text(leg.currency),
            quantity: Number(leg.quantity),
            timestamp: text(leg.timestamp),
            from: text(leg.from),
            to: text(leg.to),
            blockchain: text(leg.blockchain),
            description: text(leg.description),
            source: text(leg.source),
            importType: text(leg.importType),
            comments: ((leg.comments as { comment?: string }[] | undefined) ?? []).map((c) => text(c.comment)),
        })),
    )
}

export function latestSnapshot(stateDir: string): string {
    const dir = join(stateDir, 'snapshots')
    const names = existsSync(dir) ? readdirSync(dir).filter((n) => existsSync(join(dir, n, 'manifest.json'))).sort() : []
    if (names.length === 0) throw new Error(`No complete snapshot in ${dir}: run pull first`)
    return join(dir, names[names.length - 1])
}

export function readSnapshot(dir: string): Snapshot {
    const legs: Leg[] = []
    const history = new Map<string, string[]>()
    const detailsDir = join(dir, 'details')
    for (const name of existsSync(detailsDir) ? readdirSync(detailsDir).sort() : []) {
        const detail: ActionDetail = JSON.parse(readFileSync(join(detailsDir, name), 'utf8'))
        legs.push(...legsOf(detail))
        history.set(detail.action._id, detail.history)
    }
    const txHashes = new Set<string>()
    for (const line of readFileSync(join(dir, 'actions.jsonl'), 'utf8').split('\n')) {
        if (!line) continue
        const hash = JSON.parse(line)['Tx Hash']
        if (typeof hash === 'string') for (const h of hash.split(/[\s,]+/)) if (h) txHashes.add(normaliseTxid(h))
    }
    return { name: dir.split(/[\\/]/).pop() as string, legs, history, txHashes }
}
