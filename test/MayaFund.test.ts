import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {interpretMayaFund} from "../src/interpret/maya/fund.ts";
import {nextPayoutHeight} from "../src/sources/maya/MayaFundService.ts";
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
