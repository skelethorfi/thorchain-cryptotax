import {describe, expect, test} from "@jest/globals";
import {actionMemoSummary, interpretSend} from "../src/interpret/midgard/send";
import {RawBundle} from "../src/sources/RawBundle";
import {THORCHAIN} from "../src/domain/Protocol";

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
    test.each(['=:ARB.USDC:0xabc:0:be:16', 'swap:BTC.BTC:bc1q', '+:BTC.BTC', 'trade+:thor1x', '~:name:THOR:thor1x'])
    ('warns on a send whose memo asks for an action: %s', memo => {
        const {activities, issues} = interpretSend(send(memo), THORCHAIN);

        expect(activities).toHaveLength(1);
        expect(issues.map(issue => issue.kind)).toStrictEqual(['warning']);
    });

    test.each(['', '101663207', 'test', 'delegate:arkeo:arkeo1x', 'Huma deposit'])("doesn't warn on a note: '%s'", memo => {
        expect(interpretSend(send(memo), THORCHAIN).issues).toStrictEqual([]);
    });
});

describe('actionMemoSummary', () => {
    test('none: no line', () => {
        expect(actionMemoSummary(0, ['thorchain'])).toBeUndefined();
    });

    test('without Maya: says to add maya to protocols', () => {
        expect(actionMemoSummary(2, ['thorchain'])).toBe('WARN: 2 sends carry a memo for an action (swap, add, …) that no listed action matches, so they are exported as sends. ' +
            'Maya swaps and adds look like this: add "maya" to protocols in the config to export them as swaps and adds');
    });

    test('with Maya: says to check each', () => {
        expect(actionMemoSummary(1, ['thorchain', 'maya'])).toBe("WARN: 1 send carries a memo for an action (swap, add, …) that no listed action matches, so it is exported as a send; Maya's actions are listed too, so check each (warnings above)");
    });
});
