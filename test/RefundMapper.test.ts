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
    test('the send is one failed-out row with the native fee, whatever Midgard lists as network fees', () => {
        const action = refund([{asset: 'ETH.ETH', amount: '4929'}, {asset: 'THOR.RUNE', amount: '2000000'}]);
        action.out[0].coins[0].amount = '100000000';
        const rows = new RefundMapper().toCryptoTax(action, false);

        expect(rows).toHaveLength(1);
        expect(rows[0].type).toBe('failed-out');
        expect(rows[0].baseAmount).toBe('1');
        expect(rows[0].feeCurrency).toBe('RUNE');
        expect(rows[0].feeAmount).toBe('0.02');
        expect(rows[0].to).toBe('thorchain');
    });

    // Midgard returns both the inbound and the outbound. The outbound is not a row; what was kept is.
    test('when less comes back than was sent, the difference is a fee row', () => {
        const [send, kept] = new RefundMapper().toCryptoTax(refund([]), false);

        expect(send.type).toBe('failed-out');
        expect(send.baseAmount).toBe('1');
        expect(kept.type).toBe('fee');
        expect(kept.baseCurrency).toBe('RUNE');
        expect(kept.baseAmount).toBe('0.02');
        expect(kept.feeAmount).toBeUndefined();
    });

    test('an L1 refund uses the inbound gas THORNode observed, and the amounts for what was kept', () => {
        // Midgard's network fee (3735) differs from sent - returned (2000000): the amounts win
        const action = refund([{asset: 'BTC.BTC', amount: '3735'}]);
        action.in[0].coins[0].asset = 'BTC.BTC';
        action.out[0] = {address: 'thor1-user-wallet-11111', txID: 'tx-return', coins: [{asset: 'BTC.BTC', amount: '98000000'}]};
        const thornodeTx = {tx: {id: 'tx-refund', coins: [{asset: 'BTC.BTC', amount: '100000000'}], gas: [{asset: 'BTC.BTC', amount: '1660'}]}} as any;
        const [send, kept] = new RefundMapper().toCryptoTax(action, false, [thornodeTx]);

        expect(send.feeCurrency).toBe('BTC');
        expect(send.feeAmount).toBe('0.0000166');
        expect(kept.baseAmount).toBe('0.02');
        expect(kept.description).toContain('0.98 BTC returned in tx-return');
    });

    test('an L1 refund has a blank fee when THORNode has no record of the inbound', () => {
        const action = refund([{asset: 'BTC.BTC', amount: '3735'}]);
        action.in[0].coins[0].asset = 'BTC.BTC';
        action.out[0].coins[0].asset = 'BTC.BTC';
        const [send] = new RefundMapper().toCryptoTax(action, false);

        expect(send.feeCurrency).toBe('');
        expect(send.feeAmount).toBe('');
    });

    test('the refund of a partially filled swap, whose outputs include the swap output, has no row', () => {
        const action = refund([{asset: 'ETH.ETH', amount: '4929'}]);
        action.out.push({address: '0x-destination', txID: 'tx-swap-out', coins: [{asset: 'ETH.ETH', amount: '5000000'}]});

        expect(new RefundMapper().toCryptoTax(action, false)).toEqual([]);
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
        action.out[0].coins[0].asset = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
        const thornodeTx = {tx: {id: 'tx-refund', coins: [{asset: 'ETH.USDC-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', amount: '1'}], gas: [{asset: 'ETH.ETH', amount: '4138'}]}} as any;

        expect(new RefundMapper().toCryptoTax(action, false, [thornodeTx])[0].type).toBe('failed-out');
    });
});
