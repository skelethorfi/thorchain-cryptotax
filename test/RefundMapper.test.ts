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

    test('an L1 refund uses the outbound network fee, not the inbound gas THORNode observed', () => {
        const action = refund([{asset: 'BTC.BTC', amount: '3735'}]);
        action.in[0].coins[0].asset = 'BTC.BTC';
        const thornodeTx = {tx: {id: 'tx-refund', coins: [{asset: 'BTC.BTC', amount: '100000000'}], gas: [{asset: 'BTC.BTC', amount: '1660'}]}} as any;
        const [row] = new RefundMapper().toCryptoTax(action, false, [thornodeTx]);

        expect(row.feeCurrency).toBe('BTC');
        expect(row.feeAmount).toBe('0.00003735');
    });

    test('a refunded affiliate-fee swap, which the wallet did not send, has no row', () => {
        const action = refund([]);
        action.in[0].coins[0] = {asset: 'ETH-USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48', amount: '99900026'};
        const thornodeTx = {tx: {id: 'tx-refund', coins: [{asset: 'ETH.ETH', amount: '800000'}], gas: [{asset: 'ETH.ETH', amount: '4138'}]}} as any;

        expect(new RefundMapper().toCryptoTax(action, false, [thornodeTx])).toEqual([]);
    });

    test('a refund of what the wallet sent keeps its row when THORNode lists the same asset in another case', () => {
        const action = refund([]);
        action.in[0].coins[0].asset = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
        const thornodeTx = {tx: {id: 'tx-refund', coins: [{asset: 'ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '1'}], gas: [{asset: 'ETH.ETH', amount: '4138'}]}} as any;

        expect(new RefundMapper().toCryptoTax(action, false, [thornodeTx])).toHaveLength(1);
    });
});
