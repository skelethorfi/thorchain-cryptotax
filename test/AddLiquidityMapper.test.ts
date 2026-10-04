import {describe, expect, test} from '@jest/globals';
import {AddLiquidityMapper} from '../src/cryptotax-thorchain/AddLiquidityMapper';
import {toMidgardNanoTimestamp} from '../src/cryptotax-thorchain/MidgardUtils';

// Midgard reports a savers deposit's coin as the synth, whichever chain it was sent on
const saversDeposit = (address: string) => ({
    date: toMidgardNanoTimestamp(new Date('2022-11-14T00:00:00Z')),
    height: '1',
    status: 'success',
    type: 'addLiquidity',
    pools: ['BTC/BTC'],
    in: [{address, txID: 'tx-deposit', coins: [{asset: 'BTC/BTC', amount: '100000000'}]}],
    out: [],
    metadata: {addLiquidity: {liquidityUnits: '99000000'}},
} as any);

const depositRow = (action: any, thornodeTxs: any[] = []) =>
    new AddLiquidityMapper().toCryptoTax(action, thornodeTxs).find((row) => row.type === 'add-liquidity')!;

describe('AddLiquidityMapper', () => {
    test('a savers deposit sent from an L1 wallet has no fee without THORNode gas, not the RUNE fee', () => {
        const row = depositRow(saversDeposit('bc1q-user-wallet'));

        expect(row.feeCurrency).toBe('');
        expect(row.feeAmount).toBe('');
    });

    test('a savers deposit sent from an L1 wallet uses the gas THORNode observed', () => {
        const thornodeTx = {tx: {id: 'tx-deposit', coins: [{asset: 'BTC.BTC', amount: '100000000'}], gas: [{asset: 'BTC.BTC', amount: '2500'}]}} as any;
        const row = depositRow(saversDeposit('bc1q-user-wallet'), [thornodeTx]);

        expect(row.feeCurrency).toBe('BTC');
        expect(row.feeAmount).toBe('0.000025');
    });

    test('a savers deposit of a synth from a THORChain wallet pays the native RUNE fee', () => {
        const row = depositRow(saversDeposit('thor1-user-wallet'));

        expect(row.feeCurrency).toBe('RUNE');
        expect(row.feeAmount).toBe('0.02');
    });
});
