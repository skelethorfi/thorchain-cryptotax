import {describe, test} from "node:test";
import assert from "node:assert/strict";
import type {Activity, Leg} from '../src/domain/Activity.ts';
import {parseAmount} from '../src/domain/Amount.ts';
import {toAsset} from '../src/domain/Asset.ts';
import {THORCHAIN} from '../src/domain/Protocol.ts';
import {loanOpenRows, loanRepayRows} from '../src/export/summ/loan.ts';

describe('loan rows', () => {
    const IN = 'a'.repeat(64);
    const OUT = 'b'.repeat(64);
    const leg = (direction: Leg['direction'], wallet: string, notation: string, amount: string, txid: string): Leg =>
        ({direction, wallet, asset: toAsset(notation), amount: parseAmount(amount, 8), role: 'principal', basis: 'observed', txid});
    const activity = (kind: Activity['kind'], legs: Leg[], details: Record<string, string> = {}): Activity =>
        ({id: `midgard/swap.${IN}`, protocol: 'thorchain', kind, status: 'success', time: new Date('2024-03-01T10:00:00Z'), legs, prices: [], details});

    test('a loan paid out to an L1 wallet names its payout txid; one paid in RUNE does not', () => {
        const toBtc = loanOpenRows(activity('loan.open', [leg('out', '0xwallet', 'ETH.ETH', '100000000', IN), leg('in', 'bc1wallet', 'BTC.BTC', '1000000', OUT)]), THORCHAIN);
        const toRune = loanOpenRows(activity('loan.open', [leg('out', 'bc1wallet', 'BTC.BTC', '100000000', IN), leg('in', 'thor1wallet', 'THOR.RUNE', '1000000', '')]), THORCHAIN);

        assert.deepEqual(toBtc.map(row => row.description), [
            `1/2 - LoanOpen deposit ETH to borrow BTC; ${IN}`,
            `2/2 - LoanOpen deposit ETH to borrow BTC; ${IN}; paid out in ${OUT}`,
        ]);
        assert.equal(toRune[1].description, `2/2 - LoanOpen deposit BTC to borrow RUNE; ${IN}`);
    });

    test('collateral paid back to an L1 wallet names its payout txid', () => {
        const rows = loanRepayRows(activity('loan.repay', [leg('out', 'thor1wallet', 'THOR.RUNE', '100000000', IN), leg('in', 'bc1wallet', 'BTC.BTC', '1000000', OUT)],
            {collateral: 'BTC.BTC'}), THORCHAIN);

        assert.deepEqual(rows.map(row => row.description), [
            `1/2 - LoanRepayment deposit RUNE to repay BTC loan. Closed loan; ${IN}`,
            `2/2 - LoanRepayment deposit RUNE to repay BTC loan. Closed loan; ${IN}; paid out in ${OUT}`,
        ]);
    });
});
