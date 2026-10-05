import {describe, expect, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {Anonymiser, findSurvivors} from '../src/fixtures/Anonymise';
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

    test('a protocol-initiated swap is a different shape from a user swap', () => {
        const preferred = swap({metadata: {swap: {txType: 'swap', memo: 'MAYA-PREFERRED-ASSET-dx'}}});
        const shortForm = swap({metadata: {swap: {txType: 'swap', memo: `s:THOR.RUNE:${THOR}`}}});

        expect(getActionShape(preferred as any).memoAction).toBe('maya-preferred-asset');
        expect(sameShape(getActionShape(swap() as any), getActionShape(preferred as any))).toBe(false);
        expect(sameShape(getActionShape(swap() as any), getActionShape(shortForm as any))).toBe(true);
    });

    test('different assets or subtype are a different shape', () => {
        const eth = swap({in: [{address: '0x1', txID: 'X', coins: [{asset: 'ETH.ETH', amount: '1'}]}]});
        const loan = swap({metadata: {swap: {txType: 'loanOpen'}}});

        expect(sameShape(getActionShape(swap() as any), getActionShape(eth as any))).toBe(false);
        expect(sameShape(getActionShape(swap() as any), getActionShape(loan as any))).toBe(false);
    });
});

describe('Anonymiser', () => {
    const anon = new Anonymiser().anonymise(swap());
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

    test('ranks amounts and sets every date and block height to one fixed value', () => {
        expect(BigInt(anon.in[0].coins[0].amount)).toBeGreaterThan(BigInt(anon.metadata.swap.networkFees[0].amount));
        expect(BigInt(anon.metadata.swap.networkFees[0].amount) % 1_000_000_000n).toBe(0n);
        // A real date or height would point straight at the original block
        expect(anon.date).toBe('1609419600000000000');
        expect(anon.height).toBe('10000000');
    });

    test('ranks contract funds and attribute amounts', () => {
        const contract = new Anonymiser().anonymise({
            funds: '100x/ruji,20rune', attributes: {amount: '100', shares: '80', owner: THOR},
        });

        expect(contract).toEqual({funds: '3000000000x/ruji,1000000000rune', attributes: {amount: '3000000000', shares: '2000000000', owner: 'thor1-anon-wallet-1'}});
    });

    test('ranks Cosmos event amounts and keeps contract addresses', () => {
        const contract = 'thor13g83nn5ef4qzqeafp0508dnvkvm0zqr3sj7eefcn5umu65gqluusrml5cr';
        const event = new Anonymiser().anonymise({
            type: 'transfer',
            attributes: [{key: 'recipient', value: contract}, {key: 'sender', value: THOR}, {key: 'amount', value: '100x/ruji'}],
        });

        expect(event.attributes).toEqual([
            {key: 'recipient', value: contract},
            {key: 'sender', value: 'thor1-anon-wallet-1'},
            {key: 'amount', value: '1000000000x/ruji'},
        ]);
    });

    test('fixes every height, time and price, and replaces affiliates', () => {
        const out = new Anonymiser().anonymise({
            height: '12345678',
            metadata: {swap: {
                affiliateAddress: 'xx/yy',
                memo: `=:ETH.ETH:${THOR}:1000/1/0:xx/yy:15/25`,
                inPriceUSD: '1.5',
                streamingSwapMeta: {lastHeight: '12345681'},
            }},
            stages: {inbound_finalised: {completed: true}, outbound_signed: {scheduled_outbound_height: 12345690}},
            timestamp: '2025-08-16T22:34:43Z',
            distribution: {date: '1700000000'},
        });

        expect(out.height).toBe('10000000');
        expect(out.metadata.swap.streamingSwapMeta.lastHeight).toBe('10000000');
        expect(out.stages.outbound_signed.scheduled_outbound_height).toBe(10000000);
        expect(out.metadata.swap.affiliateAddress).toBe('name1/name2');
        // Ranks: 1 < 15 < 25 < 1000
        expect(out.metadata.swap.memo).toBe('=:ETH.ETH:thor1-anon-wallet-1:4000000000/1000000000/0:name1/name2:2000000000/3000000000');
        expect(new Anonymiser().anonymise({memo: '=:ETH.ETH:x:1000:t:10:20:ab:12345678901234567890123'}).memo)
            .toBe('=:ETH.ETH:name1:3000000000:name2:1000000000:2000000000:name3:4000000000');
        expect(out.metadata.swap.inPriceUSD).toBe('1');
        expect(out.timestamp).toBe('2020-12-31T13:00:00Z');
        expect(out.distribution.date).toBe('1609419600');
        expect(new Anonymiser().anonymise({timestamp: 1714000000000}).timestamp).toBe(1609419600000);
    });

    test('replaces every amount by its rank: equal amounts stay equal and order is kept, nothing else', () => {
        const out = new Anonymiser().anonymise({a: '500', b: '100', c: '500', zero: '0', negative: '-100', price: '1.25', other: '0.5',
            funds: '100x/ruji,20rune', memo: '=:ETH.ETH:x:500/1/0'});

        // 1 (the memo's streaming interval) < 20 < 100 < 500
        expect(out).toEqual({a: '4000000000', b: '3000000000', c: '4000000000', zero: '0', negative: '-3000000000', price: '20.5', other: '10.5',
            funds: '3000000000x/ruji,2000000000rune', memo: '=:ETH.ETH:name1:4000000000/1000000000/0'});
    });

    test('finds what survives anonymising and is not already public', () => {
        const original = {memo: '=:ETH.ETH:secretname:1000', note: 'Rarely', pool: 'BTC.BTC'};

        expect(findSurvivors(original, {memo: '=:ETH.ETH:name1:1000000000', note: 'Rarely', pool: 'BTC.BTC'}, new Set(['btc'])))
            .toEqual(['rarely']);
        expect(findSurvivors(original, new Anonymiser().anonymise(original), new Set())).toEqual(['rarely']);
    });

    test('replaces signatures, account sequences, fee coins, refund reasons and JSON inside strings', () => {
        const signature = 'MEUCIQD8mY0mQ0b3a5xq1yJt2w7vE9r5mP3+ZkLx1u7QpWlqAiBq/Zx9w==';
        const out = new Anonymiser().anonymise({
            events: [{type: 'tx', attributes: [
                {key: 'signature', value: signature},
                {key: 'acc_seq', value: `${THOR}/1234`},
                {key: 'fee', value: '2000000rune'},
            ]}],
            fee: [{denom: 'rune', amount: '2000000'}],
            reason: `emit asset 12345 less than price limit 67890 for ${THOR}`,
            msg: '{"swap":{"min_return":"987654321","to":"' + THOR + '"}}',
        });

        expect(out.events[0].attributes[0].value).toBe('anon-blob-1');
        expect(out.events[0].attributes[1].value).toBe('thor1-anon-wallet-1/1');
        // The fee attribute and the fee amount are the same coin, so they get the same rank
        expect(out.events[0].attributes[2].value).toBe(`${out.fee[0].amount}rune`);
        expect(out.reason).toBe('anonymised');
        expect(JSON.parse(out.msg)).toEqual({swap: {min_return: '2000000000', to: 'thor1-anon-wallet-1'}});
    });

    test('anonymises every memo kind: numbers ranked, names replaced, actions and assets kept', () => {
        const out = new Anonymiser().anonymise({memos: [
            `UNBOND:${THOR}:500000000000`,
            `-:BTC/BTC:10000`,
            `+:BTC.BTC:${BTC}:myname:30`,
            `=:BTC.BTC:myname`,
            `$+:BTC.BTC:${BTC}:123456`,
        ].map(memo => ({memo}))});

        expect(out.memos.map((item: any) => item.memo)).toEqual([
            'UNBOND:thor1-anon-wallet-1:4000000000',
            '-:BTC/BTC:2000000000',
            '+:BTC.BTC:bc1-anon-wallet-2:name1:1000000000',
            '=:BTC.BTC:name1',
            '$+:BTC.BTC:bc1-anon-wallet-2:3000000000',
        ]);
    });

    test('keeps token contracts in asset names, ranks equal decimals alike, and handles large and ISO values', () => {
        const usdc = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48';
        const out = new Anonymiser().anonymise({asset: usdc, a: '1.50', b: '1.5', big: 1e21, time: '2025-08-16T22:34:43.123Z'});

        expect(out.asset).toBe(usdc);
        expect(out.a).toBe(out.b);
        expect(out.big).toBe(1000000000);
        expect(out.time).toBe('2020-12-31T13:00:00Z');
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
