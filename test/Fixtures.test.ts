import {describe, expect, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {Anonymiser} from '../src/fixtures/Anonymise';
import {PrivateData} from '../src/fixtures/PrivateData';
import {getActionShape, sameShape} from '../src/fixtures/Shape';
import {findCaseDirs, readCaseInput, runCase} from '../src/fixtures/GoldenCase';

const TXID = '1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF';
const THOR = 'thor1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const BTC = 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

const swap = (overrides: any = {}) => ({
    date: '1700000000000000000',
    height: '1',
    status: 'success',
    type: 'swap',
    pools: ['BTC.BTC'],
    in: [{address: BTC, txID: TXID, coins: [{asset: 'BTC.BTC', amount: '100000000'}]}],
    out: [{address: THOR, txID: '', coins: [{asset: 'THOR.RUNE', amount: '5000000000'}]}],
    metadata: {swap: {txType: 'swap', memo: `=:THOR.RUNE:${THOR}`, liquidityFee: '1000', networkFees: [{asset: 'THOR.RUNE', amount: '2000000'}]}},
    ...overrides,
});

describe('PrivateData', () => {
    test('loads addresses, txids and denylist entries from a private folder', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-private-'));
        fs.outputFileSync(path.join(dir, 'a.toml'), `address = "${THOR}"\n`);
        fs.outputJsonSync(path.join(dir, 'cache/x.json'), {txID: TXID.toLowerCase(), zero: '0'.repeat(64)});
        fs.outputFileSync(path.join(dir, 'private-denylist.txt'), '# note\nsecret-label\n');

        const data = PrivateData.load(dir);

        expect(data.isPrivate(THOR.toUpperCase())).toBe(true);
        expect(data.isPrivate(TXID)).toBe(true);
        expect(data.isPrivate('0'.repeat(64))).toBe(false);
        expect(data.findIn(`hello secret-label ${TXID}`)).toHaveLength(2);
    });

    test('is empty when the private folder does not exist', () => {
        expect(PrivateData.load('/nonexistent/tc-ct').patterns.size).toBe(0);
    });
});

describe('Shape', () => {
    test('same type, subtype and assets have the same shape regardless of addresses and amounts', () => {
        const other = swap({in: [{address: 'bc1qother', txID: 'X', coins: [{asset: 'BTC.BTC', amount: '1'}]}]});

        expect(sameShape(getActionShape(swap() as any), getActionShape(other as any))).toBe(true);
    });

    test('contract shape includes the contract type and the denoms in funds', () => {
        const bond = (funds: string) => ({type: 'contract', status: 'success', in: [{coins: []}], out: [{coins: []}],
            metadata: {contract: {contractType: 'wasm-rujira-staking/liquid.bond', funds}}});

        expect(getActionShape(bond('100x/ruji') as any)).toMatchObject({subtype: 'wasm-rujira-staking/liquid.bond', funds: ['x/ruji']});
        expect(sameShape(getActionShape(bond('100x/ruji') as any), getActionShape(bond('5x/ruji') as any))).toBe(true);
        expect(sameShape(getActionShape(bond('100x/ruji') as any), getActionShape(bond('5rune') as any))).toBe(false);
    });

    test('different assets or subtype are a different shape', () => {
        const eth = swap({in: [{address: '0x1', txID: 'X', coins: [{asset: 'ETH.ETH', amount: '1'}]}]});
        const loan = swap({metadata: {swap: {txType: 'loanOpen'}}});

        expect(sameShape(getActionShape(swap() as any), getActionShape(eth as any))).toBe(false);
        expect(sameShape(getActionShape(swap() as any), getActionShape(loan as any))).toBe(false);
    });
});

describe('Anonymiser', () => {
    const anon = new Anonymiser({amountFactor: 0.5, dateShiftDays: 1}).anonymise(swap());
    const text = JSON.stringify(anon);

    test('replaces addresses and txids everywhere, including inside memos', () => {
        expect(text).not.toContain(THOR);
        expect(text).not.toContain(BTC);
        expect(text).not.toContain(TXID);
        expect(anon.in[0].address).toBe('bc1-anon-wallet-1');
        expect(anon.out[0].address).toBe('thor1-anon-wallet-2');
        expect(anon.metadata.swap.memo).toBe('=:THOR.RUNE:thor1-anon-wallet-2');
    });

    test('maps the same value to the same placeholder', () => {
        const again = new Anonymiser().anonymise({a: THOR, b: THOR.toUpperCase(), t1: TXID, t2: TXID.toLowerCase()});

        expect(again.a).toBe(again.b);
        expect(again.t1).toBe(again.t2);
        expect(again.t1).toMatch(/^[0-9A-F]{64}$/);
    });

    test('scales amounts and shifts dates', () => {
        expect(anon.in[0].coins[0].amount).toBe('50000000');
        expect(anon.metadata.swap.networkFees[0].amount).toBe('1000000');
        expect(anon.date).toBe('1700086400000000000');
        expect(anon.height).toBe('1');
    });

    test('scales contract funds and attribute amounts', () => {
        const contract = new Anonymiser({amountFactor: 0.5, dateShiftDays: 0}).anonymise({
            funds: '100x/ruji,20rune', attributes: {amount: '100', shares: '80', owner: THOR},
        });

        expect(contract).toEqual({funds: '50x/ruji,10rune', attributes: {amount: '50', shares: '40', owner: 'thor1-anon-wallet-1'}});
    });

    test('keeps the all-zero placeholder txid', () => {
        expect(new Anonymiser().anonymise({txID: '0'.repeat(64)}).txID).toBe('0'.repeat(64));
    });

    test('anonymised existing cases still map without errors', () => {
        for (const dir of findCaseDirs(path.join(__dirname, 'cases'))) {
            const input = readCaseInput(dir);
            expect(() => runCase(new Anonymiser().anonymise(input))).not.toThrow();
        }
    });
});
