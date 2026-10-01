import {describe, expect, test} from '@jest/globals';
import {RefundMapper} from '../src/cryptotax-thorchain/RefundMapper';
import {toMidgardNanoTimestamp} from '../src/cryptotax-thorchain/MidgardUtils';

const refund = (networkFees: {asset: string, amount: string}[]) => ({
    date: toMidgardNanoTimestamp(new Date('2023-03-22T00:00:00Z')),
    height: '1',
    status: 'success',
    type: 'refund',
    pools: [],
    in: [{address: 'thor1-user-wallet-11111', txID: 'tx-refund', coins: [{asset: 'THOR.RUNE', amount: '100000000'}]}],
    out: [{address: 'thor1-user-wallet-11111', txID: '', coins: [{asset: 'THOR.RUNE', amount: '98000000'}]}],
    metadata: {refund: {networkFees, reason: 'bad memo', memo: ''}},
} as any);

describe('RefundMapper', () => {
    test('uses the fee in the refunded asset', () => {
        const [row] = new RefundMapper().toCryptoTax(refund([{asset: 'ETH.ETH', amount: '4929'}, {asset: 'THOR.RUNE', amount: '2000000'}]), false);

        expect(row.feeCurrency).toBe('RUNE');
        expect(row.feeAmount).toBe('0.02');
    });

    test('has no fee when Midgard lists no network fees', () => {
        const [row] = new RefundMapper().toCryptoTax(refund([]), false);

        expect(row.feeCurrency).toBe('');
        expect(row.feeAmount).toBe('');
        expect(row.baseAmount).toBe('1');
    });
});
