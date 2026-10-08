import {describe, expect, test} from '@jest/globals';
import {runBundle} from '../src/pipeline/run';
import {THORCHAIN} from '../src/domain/Protocol';
import {toMidgardNanoTimestamp} from '../src/sources/thorchain/MidgardUtils';

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
    runBundle({source: 'midgard', protocol: 'thorchain', wallet: '', data: action, thornodeTxs, cosmosTxs: []}, THORCHAIN)
        .rows.find((row) => row.type === 'add-liquidity')!;

describe('liquidity', () => {
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

describe('Maya liquidity auction', () => {
    test('a RUNE side less than the deposits adds no RUNE at the end and asks for it by hand', async () => {
        const path = await import('path');
        const {readCaseInput, toBundle} = await import('../src/fixtures/GoldenCase');
        const {runBundle} = await import('../src/pipeline/run');
        const {MAYA} = await import('../src/domain/Protocol');
        const input = readCaseInput(path.join(__dirname, 'cases', 'maya', 'liquidity-auction'));
        const bigDeposit = {...input.inbounds![0], in: [{...input.inbounds![0].in[0], coins: [{asset: 'THOR.RUNE', amount: '200000000000'}]}]};

        const {rows, issues} = runBundle(toBundle({...input, inbounds: [bigDeposit, ...input.inbounds!.slice(1)]}), MAYA);

        expect(issues.map(issue => issue.kind)).toEqual(['manual']);
        expect(rows.filter(row => row.type === 'income').map(row => row.baseCurrency)).toEqual(['CACAO']);
    });
});
