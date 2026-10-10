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
