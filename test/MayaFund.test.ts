import {describe, mock, test} from "node:test";
import assert from "node:assert/strict";
import {interpretMayaFund} from "../src/interpret/maya/fund.ts";
import fs from "fs-extra";
import os from "os";
import path from "path";
import {DIVIDENDS_FROM_HEIGHT, MAYA_FUND_INTERVAL, MayaFundService, nextPayoutHeight} from "../src/sources/maya/MayaFundService.ts";
import {http} from "../src/sources/http.ts";
import {RecordStore} from "../src/sources/store/RecordStore.ts";
import {MAYA} from "../src/domain/Protocol.ts";
import type {RawBundle} from "../src/sources/RawBundle.ts";

const payout = (cacao: string, maya: string): RawBundle => ({
    source: 'maya-fund', protocol: 'maya', wallet: 'maya1-user-wallet-11111', thornodeTxs: [], cosmosTxs: [],
    data: {height: 14400, date: '1700000000000000000', cacao, maya, from: 'balance'},
});

describe('Maya fund', () => {
    test('a payout of nothing (no MAYA held) is not an activity', () => {
        assert.deepEqual(interpretMayaFund(payout('0', '0'), MAYA), []);
    });

    test('a payout is CACAO, in base units of 1e10, with the MAYA held in base units of 1e4', () => {
        const [activity] = interpretMayaFund(payout('12345678901', '15841'), MAYA);

        assert.equal(activity.legs[0].amount.base, 12345678901n);
        assert.equal(activity.legs[0].amount.decimals, 10);
        assert.equal(activity.details.maya, '1.5841');
    });

    test('payouts are at every height divisible by 14400, the first after the given height', () => {
        assert.deepEqual([nextPayoutHeight(1), nextPayoutHeight(14399), nextPayoutHeight(14400)], [14400, 14400, 28800]);
    });
});

// A Midgard where each payout adds 100 to the wallet's CACAO and the chain is at `tip`
function fakeMidgard(tip: number, hasDividends: boolean) {
    const paidBy = (height: number) => Math.floor(height / MAYA_FUND_INTERVAL) * 100;
    return mock.method(http, 'get', async (url: string) => {
        if (url.endsWith('/v2/health')) {
            return {data: {lastAggregated: {height: tip}}};
        }

        const balance = /\/v2\/balance\/.*\?height=(\d+)/.exec(url);

        if (balance) {
            const height = Number(balance[1]);
            return {data: {date: `${height}000000000`, coins: [{asset: 'MAYA.CACAO', amount: String(paidBy(height))}, {asset: 'MAYA', amount: '50000'}]}};
        }

        if (url.includes('/dividends') && hasDividends) {
            const from = Number(/from=(\d+)/.exec(url)?.[1] ?? 0);
            const heights = [];
            for (let height = DIVIDENDS_FROM_HEIGHT; height <= tip; height += MAYA_FUND_INTERVAL) heights.push(height);
            return {data: {dividends: heights.filter(height => height >= from).reverse().map(height => ({date: String(height), height: String(height), amount: '100'}))}};
        }

        throw Object.assign(new Error('not found'), {response: {status: 404}});
    });
}

describe('MayaFundService', () => {
    const wallet = 'maya1-user-wallet-11111';
    const firstHeight = DIVIDENDS_FROM_HEIGHT - 2 * MAYA_FUND_INTERVAL - 5;
    const store = () => new RecordStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-maya-fund-')));
    const summary = (payouts: {height: number; cacao: string; from: string}[]) =>
        payouts.map(payout => [payout.height - DIVIDENDS_FROM_HEIGHT, payout.cacao, payout.from]);

    test("reads payouts before the dividends list from balances, and later ones from the list", async () => {
        const get = fakeMidgard(DIVIDENDS_FROM_HEIGHT + MAYA_FUND_INTERVAL + 7, true);

        const payouts = await new MayaFundService(store(), 'https://midgard', 'https://node').getPayouts(wallet, firstHeight, new Set());

        assert.deepEqual(summary(payouts), [
            [-2 * MAYA_FUND_INTERVAL, '100', 'balance'], [-MAYA_FUND_INTERVAL, '100', 'balance'],
            [0, '100', 'dividends'], [MAYA_FUND_INTERVAL, '100', 'dividends'],
        ]);
        get.mock.restore();
    });

    test('reads every payout from balances when this Midgard has no dividends list', async () => {
        const get = fakeMidgard(DIVIDENDS_FROM_HEIGHT + MAYA_FUND_INTERVAL + 7, false);

        const payouts = await new MayaFundService(store(), 'https://midgard', 'https://node').getPayouts(wallet, firstHeight, new Set());

        assert.deepEqual(payouts.map(payout => payout.from), ['balance', 'balance', 'balance', 'balance']);
        get.mock.restore();
    });

    test('a later run asks only for payouts after the last one stored', async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-maya-fund-'));
        let get = fakeMidgard(DIVIDENDS_FROM_HEIGHT + 7, true);
        await new MayaFundService(new RecordStore(root), 'https://midgard', 'https://node').getPayouts(wallet, firstHeight, new Set());
        get.mock.restore();
        get = fakeMidgard(DIVIDENDS_FROM_HEIGHT + 2 * MAYA_FUND_INTERVAL + 7, true);

        const payouts = await new MayaFundService(new RecordStore(root), 'https://midgard', 'https://node').getPayouts(wallet, firstHeight, new Set());

        assert.equal(payouts.length, 5);
        assert.deepEqual(get.mock.calls.map(call => call.arguments[0]).filter(url => !url.endsWith('/health')),
            [`https://midgard/v2/maya/${wallet}/dividends?limit=400&offset=0&from=${DIVIDENDS_FROM_HEIGHT + 1}`]);
        get.mock.restore();
    });
});

describe('MayaFundService, reading from balances', () => {
    const wallet = 'maya1-user-wallet-11111';
    const at = (k: number) => MAYA_FUND_INTERVAL * k;
    const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-maya-fund-'));
    const service = (dir: string) => new MayaFundService(new RecordStore(dir), 'https://midgard', 'https://node');

    // Payouts at heights at(1)..at(3), all before the dividends list; cacao(height) gives the balance, and a block
    // read gives `event` CACAO to the wallet
    function fake(cacao: (height: number) => number, event = 7, fail?: number) {
        return mock.method(http, 'get', async (url: string) => {
            if (url.endsWith('/v2/health')) {
                return {data: {lastAggregated: {height: at(3) + 5}}};
            }

            if (url.includes('/dividends')) {
                return {data: {dividends: []}};
            }

            const block = /\/mayachain\/block\?height=(\d+)/.exec(url);

            if (block) {
                return {data: {end_block_events: [{type: 'distribute_maya_fund', cacao_address: wallet, cacao_amount: String(event)}]}};
            }

            const height = Number(/height=(\d+)/.exec(url)![1]);

            if (height === fail) {
                throw Object.assign(new Error('bad request'), {response: {status: 400}});
            }

            return {data: {date: `${height}000000000`, coins: [{asset: 'MAYA.CACAO', amount: String(cacao(height))}, {asset: 'MAYA', amount: '50000'}]}};
        });
    }

    test("a step below 0, or the wallet's own action in the block, is read from the block's event", async () => {
        // At at(2) the wallet also spent 1000 CACAO
        const get = fake(height => Math.floor(height / MAYA_FUND_INTERVAL) * 100 - (height >= at(2) ? 1000 : 0));

        const payouts = await service(root()).getPayouts(wallet, 1, new Set([at(3)]));

        assert.deepEqual(payouts.map(payout => [payout.cacao, payout.from]), [['100', 'balance'], ['7', 'event'], ['7', 'event']]);
        get.mock.restore();
    });

    test('payouts read before a failure are kept, and the next run resumes after them', async () => {
        const dir = root();
        const paid = (height: number) => Math.floor(height / MAYA_FUND_INTERVAL) * 100;
        let get = fake(paid, 7, at(3));
        await assert.rejects(service(dir).getPayouts(wallet, 1, new Set()));
        get.mock.restore();
        get = fake(paid);

        const payouts = await service(dir).getPayouts(wallet, 1, new Set());

        assert.deepEqual(payouts.map(payout => payout.height), [at(1), at(2), at(3)]);
        assert.deepEqual(get.mock.calls.map(call => call.arguments[0]).filter(url => url.includes('/balance/')),
            [`https://midgard/v2/balance/${wallet}?height=${at(3) - 1}`, `https://midgard/v2/balance/${wallet}?height=${at(3)}`]);
        get.mock.restore();
    });
});

describe('MayaFundService, dividends list', () => {
    test('a payout listed on two pages (made between them) is kept once', async () => {
        const wallet = 'maya1-user-wallet-11111';
        const top = DIVIDENDS_FROM_HEIGHT + 400 * MAYA_FUND_INTERVAL;
        const item = (height: number) => ({date: String(height), height: String(height), amount: '100'});
        const get = mock.method(http, 'get', async (url: string) => {
            if (url.endsWith('/v2/health')) {
                return {data: {lastAggregated: {height: top + 5}}};
            }

            // 401 payouts, newest first; the second page repeats the last of the first
            const all = Array.from({length: 401}, (_, i) => top - i * MAYA_FUND_INTERVAL).map(item);
            const offset = Number(/offset=(\d+)/.exec(url)![1]);
            return {data: {dividends: offset === 0 ? all.slice(0, 400) : all.slice(399)}};
        });

        const payouts = await new MayaFundService(new RecordStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-maya-fund-'))), 'https://midgard', 'https://node')
            .getPayouts(wallet, DIVIDENDS_FROM_HEIGHT - 1, new Set());

        assert.equal(payouts.length, 401);
        assert.equal(new Set(payouts.map(payout => payout.height)).size, 401);
        get.mock.restore();
    });
});

describe('MayaFundSource', () => {
    test("starts after the wallet's first MAYA receipt, and counts outbound heights as its own actions", async () => {
        const {MayaFundSource} = await import('../src/sources/Source.ts');
        const wallet = 'maya1-user-wallet-11111';
        const tx = (address: string, asset: string, height?: string) => ({address, coins: [{asset, amount: '1'}], txID: 'A', ...(height ? {height} : {})});
        const actions = [
            {height: '500', in: [tx(wallet, 'MAYA.CACAO')], out: [tx(wallet, 'MAYA.CACAO', '900')]},
            {height: '300', in: [tx('maya1-other', 'MAYA')], out: [tx(wallet, 'MAYA')]},
        ];
        const calls: unknown[][] = [];
        const source = new MayaFundSource({getActions: async () => actions} as any,
            {getPayouts: async (...args: unknown[]) => { calls.push(args); return []; }} as any);

        await source.bundlesFor(wallet);

        assert.deepEqual(calls, [[wallet, 300, new Set([500, 900, 300])]]);
    });
});
