import type {RecordStore} from "../store/RecordStore.ts";
import {mayaFundList} from "../store/Sources.ts";
import {http} from "../http.ts";

// Maya pays CACAO to MAYA holders at every height divisible by this (docs/specs/maya.md, Maya fund)
export const MAYA_FUND_INTERVAL = 14400;

// Maya's Midgard lists payouts (/v2/maya/<address>/dividends) from this height on, for every holder
export const DIVIDENDS_FROM_HEIGHT = 14947200;

const DIVIDENDS_PAGE = 400;

// One payout to one wallet. There is no tx. From DIVIDENDS_FROM_HEIGHT on, Midgard's dividends list gives it;
// before, or when that endpoint is missing, it is the step in the wallet's CACAO balance across the payout block,
// or, when the wallet had its own action in that block, the block's distribute_maya_fund event.
export interface MayaFundPayout {
    height: number;
    // Midgard's date of the block, Unix nanoseconds
    date: string;
    // CACAO paid, base units (1e10)
    cacao: string;
    // MAYA held just before, base units (1e4); only the balance step gives it
    maya?: string;
    from: 'dividends' | 'balance' | 'event';
}

interface DividendItem {
    // Unix seconds
    date: string;
    height: string;
    amount: string;
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
            const start = nextPayoutHeight(last ?? firstHeight);
            const payouts = [...stored];
            console.log(`[Maya fund] ${wallet}: payouts after ${last ?? firstHeight} up to ${tip}`);
            const listed = start <= tip ? await this.dividends(wallet, Math.max(start, DIVIDENDS_FROM_HEIGHT), stored.at(-1)) : undefined;
            // Without the dividends list (an older Midgard), every height is read from balances
            const balanceUntil = listed ? Math.min(DIVIDENDS_FROM_HEIGHT - 1, tip) : tip;

            for (let height = start; height <= balanceUntil; height += MAYA_FUND_INTERVAL) {
                payouts.push(await this.payout(wallet, height, actionHeights.has(height)));
            }

            payouts.push(...(listed ?? []).filter(payout => payout.height >= start && payout.height <= tip));
            return {data: payouts, url: `${this.midgardUrl}/v2/maya/${wallet}/dividends, and /v2/balance/${wallet}?height= before ${DIVIDENDS_FROM_HEIGHT}`};
        }, mayaFundList(wallet));
    }

    // Midgard's payouts to the wallet from a height on, oldest first; undefined when this Midgard has no such
    // endpoint (404). It lists only payouts of more than 0. after: the last payout stored, to ask only for later ones.
    private async dividends(wallet: string, fromHeight: number, after?: MayaFundPayout): Promise<MayaFundPayout[] | undefined> {
        const from = after ? `&from=${Number(BigInt(after.date) / 1_000_000_000n) + 1}` : '';
        const items: DividendItem[] = [];

        for (let offset = 0; ; offset += DIVIDENDS_PAGE) {
            const url = `${this.midgardUrl}/v2/maya/${wallet}/dividends?limit=${DIVIDENDS_PAGE}&offset=${offset}${from}`;
            let page: DividendItem[];

            try {
                page = (await http.get(url)).data.dividends ?? [];
            } catch (error: any) {
                if (error?.response?.status === 404) {
                    console.warn(`[Maya fund] ${this.midgardUrl} has no dividends list: reading every payout from balances`);
                    return undefined;
                }

                throw error;
            }

            items.push(...page);

            if (page.length < DIVIDENDS_PAGE) {
                break;
            }
        }

        return items
            .map(item => ({height: Number(item.height), date: `${item.date}000000000`, cacao: item.amount, from: 'dividends' as const}))
            .filter(payout => payout.height >= fromHeight)
            .sort((a, b) => a.height - b.height);
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
