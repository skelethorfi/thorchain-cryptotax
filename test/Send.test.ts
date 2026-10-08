import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {ACTION_MEMO_WARNING, actionMemoSummary, interpretSend, SELF_SEND_MEMO_WARNING} from "../src/interpret/midgard/send.ts";
import type {RawBundle} from "../src/sources/RawBundle.ts";
import {THORCHAIN} from "../src/domain/Protocol.ts";

const send = (memo: string): RawBundle => ({
    source: 'midgard', protocol: 'thorchain', wallet: 'thor1-user-wallet-11111', thornodeTxs: [], cosmosTxs: [],
    data: {
        type: 'send', status: 'success', date: '1700000000000000000', height: '1', pools: [],
        in: [{address: 'thor1-user-wallet-11111', txID: 'A'.repeat(64), coins: [{asset: 'THOR.RUNE', amount: '100000000'}]}],
        out: [{address: 'thor1-other-wallet-2222', txID: '', coins: [{asset: 'THOR.RUNE', amount: '100000000'}]}],
        metadata: {send: {memo, code: '0', reason: '', networkFees: []}},
    } as any,
});

describe('interpretSend', () => {
    for (const memo of ['=:ARB.USDC:0xabc:0:be:16', 'swap:BTC.BTC:bc1q', '+:BTC.BTC', 'trade+:thor1x', '~:name:THOR:thor1x']) {
        test(`warns on a send whose memo asks for an action: ${memo}`, () => {
            const {activities, issues} = interpretSend(send(memo), THORCHAIN);

            assert.equal(activities.length, 1);
            assert.deepEqual(issues.map(issue => issue.kind), ['warning']);
        });
    }

    test('a send to itself with an action memo reached no protocol: it says so, and is not counted as an unmatched action', () => {
        const toSelf = send('tcy:thor1-user-wallet-11111');
        (toSelf.data as any).out[0].address = 'thor1-user-wallet-11111';

        const {activities, issues} = interpretSend(toSelf, THORCHAIN);

        assert.equal(activities.length, 1);
        assert.deepEqual(issues.map(issue => issue.message), [`${SELF_SEND_MEMO_WARNING}: tcy:thor1-user-wallet-11111`]);
        assert.equal(issues[0].message.startsWith(ACTION_MEMO_WARNING), false);
    });

    for (const memo of ['', '101663207', 'test', 'delegate:arkeo:arkeo1x', 'Huma deposit']) {
        test(`doesn't warn on a note: '${memo}'`, () => {
            assert.deepEqual(interpretSend(send(memo), THORCHAIN).issues, []);
        });
    }
});

describe('actionMemoSummary', () => {
    test('none: no line', () => {
        assert.equal(actionMemoSummary(0, ['thorchain']), undefined);
    });

    test('without Maya: says to add maya to protocols', () => {
        assert.equal(actionMemoSummary(2, ['thorchain']), 'WARN: 2 sends carry a memo for an action (swap, add, …) that no listed action matches, so they are exported as sends. ' +
            'Maya swaps and adds look like this: add "maya" to protocols in the config to export them as swaps and adds');
    });

    test('with Maya: says to check each', () => {
        assert.equal(actionMemoSummary(1, ['thorchain', 'maya']), "WARN: 1 send carries a memo for an action (swap, add, …) that no listed action matches, so it is exported as a send; Maya's actions are listed too, so check each (warnings above)");
    });
});

describe('income from a listed sender', () => {
    test('the same transfer is a receive, or income when its sender is in incomeFrom, with one ID', async () => {
        const path = await import('path');
        const {readCaseInput, toBundle} = await import('../src/fixtures/GoldenCase.ts');
        const {runBundle} = await import('../src/pipeline/run.ts');
        const {MAYA} = await import('../src/domain/Protocol.ts');
        const input = readCaseInput(path.join(import.meta.dirname, 'cases', 'maya', 'send-maya-income'));
        const sender = input.treatment!.incomeFrom![0];

        const [plain] = runBundle(toBundle(input), MAYA).rows;
        const [income] = runBundle(toBundle(input), MAYA, {incomeFrom: [sender.toUpperCase()]}).rows;

        assert.deepEqual([plain.type, income.type], ['receive', 'income']);
        assert.equal(income.id, plain.id);
    });
});

describe('known distribution wallets', () => {
    test("their MAYA is income unless incomeFrom is set; their other assets are not", async () => {
        const {isIncomeReceipt, KNOWN_DISTRIBUTORS} = await import('../src/export/summ/send.ts');
        const [known] = KNOWN_DISTRIBUTORS;

        assert.equal(isIncomeReceipt(known.address.toUpperCase(), 'MAYA.MAYA'), true);
        assert.equal(isIncomeReceipt(known.address, 'MAYA.CACAO'), false);
        assert.equal(isIncomeReceipt('maya1-someone-else', 'MAYA.MAYA'), false);
        assert.equal(isIncomeReceipt(known.address, 'MAYA.MAYA', []), false);
        assert.equal(isIncomeReceipt(known.address, 'MAYA.CACAO', [known.address]), true);
    });

    test('the summary counts income by default and warns of their other receipts', async () => {
        const {knownDistributorReport, KNOWN_DISTRIBUTORS} = await import('../src/export/summ/send.ts');
        const from = KNOWN_DISTRIBUTORS[0].address;
        const rows = [{type: 'income', baseCurrency: 'MAYA', from}, {type: 'receive', baseCurrency: 'CACAO', from}, {type: 'receive', baseCurrency: 'CACAO', from: 'maya1-other'}] as any[];

        const report = knownDistributorReport(rows);

        assert.deepEqual(report.info, ['1 receipts from known distribution wallets are income (incomeFrom is not set; docs/specs/sends.md)']);
        assert.deepEqual(report.warnings, [`WARN: 1 receipts from known distribution wallets are plain receives (CACAO from …${from.slice(-8)}): if they are income, list the sender in incomeFrom`]);
        assert.deepEqual(knownDistributorReport(rows, [from]).info, []);
    });
});
