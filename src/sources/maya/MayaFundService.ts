import type {RecordStore} from "../store/RecordStore.ts";
import {mayaFundList} from "../store/Sources.ts";
import {http} from "../http.ts";

// Maya pays CACAO to MAYA holders at every height divisible by this (docs/specs/maya.md, Maya fund)
export const MAYA_FUND_INTERVAL = 14400;

// One payout to one wallet. There is no tx: the amount is the step in the wallet's CACAO balance across the
// payout block, or, when the wallet had its own action in that block, the block's distribute_maya_fund event.
export interface MayaFundPayout {
    height: number;
    // Midgard's date of the block, Unix nanoseconds
    date: string;
    // CACAO paid, base units (1e10)
    cacao: string;
    // MAYA held just before, base units (1e4)
    maya: string;
    from: 'balance' | 'event';
}

export function getPayoutDate(payout: MayaFundPayout): Date {
    return new Date(Number(BigInt(payout.date) / 1_000_000n));
}

// The first payout height after a height
export function nextPayoutHeight(height: number): number {
    return (Math.floor(height / MAYA_FUND_INTERVAL) + 1) * MAYA_FUND_INTERVAL;
}

interface Balance {
    date: string;
    cacao: bigint;
    maya: bigint;
}

export class MayaFundService {
    private store: RecordStore;
    private midgardUrl: string;
    private nodeUrl: string;
    private source: string;
    constructor(store: RecordStore, midgardUrl: string, nodeUrl: string, source: string = 'maya-fund') {
        this.store = store;
        this.midgardUrl = midgardUrl;
        this.nodeUrl = nodeUrl;
        this.source = source;
    }

    // Every payout to the wallet from the first after firstHeight (its first MAYA receipt). A payout never changes,
    // so a fetch reads only the heights after the last one stored. actionHeights: of the wallet's own actions.
    async getPayouts(wallet: string, firstHeight: number, actionHeights: Set<number>): Promise<MayaFundPayout[]> {
        return this.store.list(this.source, wallet, async () => {
            const stored = this.storedPayouts(wallet);
            const last = stored[stored.length - 1]?.height;
            const tip = await this.tip();
            const payouts = [...stored];
            console.log(`[Maya fund] ${wallet}: payouts after ${last ?? firstHeight} up to ${tip}`);

            for (let height = nextPayoutHeight(last ?? firstHeight); height <= tip; height += MAYA_FUND_INTERVAL) {
                payouts.push(await this.payout(wallet, height, actionHeights.has(height)));
            }

            return {data: payouts, url: `${this.midgardUrl}/v2/balance/${wallet}?height=<payout height − 1 and payout height>`};
        }, mayaFundList(wallet));
    }

    private storedPayouts(wallet: string): MayaFundPayout[] {
        const prefix = `${wallet}.`;
        return this.store.keys(this.source)
            .filter(key => key.startsWith(prefix))
            .map(key => this.store.copies<MayaFundPayout>(this.source, key).at(-1)!.data)
            .sort((a, b) => a.height - b.height);
    }

    // The last height Midgard has aggregated: its balances are known up to there
    private async tip(): Promise<number> {
        const health = (await http.get(`${this.midgardUrl}/v2/health`)).data;
        return Number(health.lastAggregated.height);
    }

    private async payout(wallet: string, height: number, hasOwnAction: boolean): Promise<MayaFundPayout> {
        const before = await this.balance(wallet, height - 1);
        const after = await this.balance(wallet, height);
        const cacao = hasOwnAction ? await this.eventAmount(wallet, height) : after.cacao - before.cacao;
        return {height, date: after.date, cacao: String(cacao), maya: String(before.maya), from: hasOwnAction ? 'event' : 'balance'};
    }

    private async balance(wallet: string, height: number): Promise<Balance> {
        const data = (await http.get(`${this.midgardUrl}/v2/balance/${wallet}?height=${height}`)).data;
        const amount = (asset: string) => BigInt(data.coins?.find((coin: {asset: string}) => coin.asset === asset)?.amount ?? '0');
        return {date: String(data.date), cacao: amount('MAYA.CACAO'), maya: amount('MAYA')};
    }

    // The block's event, for a block in which the wallet's own action also moved its CACAO (several MB)
    private async eventAmount(wallet: string, height: number): Promise<bigint> {
        const block = (await http.get(`${this.nodeUrl}/mayachain/block?height=${height}`)).data;
        const events: {type: string; cacao_address?: string; cacao_amount?: string}[] = block.end_block_events ?? [];
        const paid = events.filter(event => event.type === 'distribute_maya_fund' && event.cacao_address === wallet);
        return paid.reduce((sum, event) => sum + BigInt(event.cacao_amount ?? '0'), 0n);
    }
}
