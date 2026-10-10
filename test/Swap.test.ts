import { runBundle } from '../src/pipeline/run.ts';
import type { Action, Transaction } from '@xchainjs/xchain-midgard';
import {describe, test} from "node:test";
import assert from "node:assert/strict";
import { CryptoTaxTransactionType } from '../src/export/summ/csv/index.ts';
import { toMidgardNanoTimestamp } from '../src/sources/thorchain/MidgardUtils.ts';
import { MAYA, type Protocol, THORCHAIN } from '../src/domain/Protocol.ts';

describe('swap', () => {
    // A swap through the exporter's path: interpreted, then exported as rows. A failure throws.
    const swap = (action: Action, thornodeTxs: any[] = [], protocol: Protocol = THORCHAIN) => {
        const bundle = {source: 'midgard' as const, protocol: protocol.id, wallet: '', data: action, thornodeTxs, cosmosTxs: []};
        const {rows, issues} = runBundle(bundle, protocol);
        const failure = issues.find(issue => issue.kind === 'failed');

        if (failure) {
            throw new Error(failure.message);
        }

        return rows;
    };

    const createMockAction = ({
        inputAsset,
        inputAmount,
        outputAsset,
        outputAmount,
        inputAddress,
        outputAddress,
        txID,
    }: {
        inputAsset: string;
        inputAmount: number;
        outputAsset: string;
        outputAmount: number;
        inputAddress: string;
        outputAddress: string;
        txID: string;
    }): Action => ({
        date: toMidgardNanoTimestamp(new Date('2023-04-01T12:00:00Z')),
        height: '1000000',
        in: [
            {
                address: inputAddress,
                coins: [
                    {
                        asset: inputAsset,
                        amount: '' + inputAmount * Math.pow(10, 8),
                    },
                ],
                txID,
            } as Transaction,
        ],
        out: [
            {
                address: outputAddress,
                coins: [
                    {
                        asset: outputAsset,
                        amount: '' + outputAmount * Math.pow(10, 8),
                    },
                ],
                // The payout's own tx on the output chain
                txID: `out-${txID}`,
            } as Transaction,
        ],
        metadata: {
            swap: {
                memo: `=:${outputAsset}:${outputAddress}`,
                networkFees: [{ asset: 'THOR.RUNE', amount: '1000000' }],
                affiliateAddress: '',
                affiliateFee: '0',
                isStreamingSwap: false,
                liquidityFee: '0',
                swapTarget: '0',
                swapSlip: '0',
                txType: 'swap',
                inPriceUSD: '',
                outPriceUSD: '',
            },
        },
        pools: [],
        status: 'success',
        type: 'swap',
    });

    const createMockThornodeTx = ({
        txID,
        gasAsset,
        gasAmount,
    }: {
        txID: string;
        gasAsset: string;
        gasAmount: string;
    }) => ({
        tx: {
            id: txID,
            gas: [
                {
                    asset: gasAsset,
                    amount: gasAmount,
                },
            ],
        },
    });

    test('should error on incorrect asset string', () => {
        const action = createMockAction({
            inputAsset: 'BTCBTC',
            inputAmount: 1,
            outputAsset: 'ETH.ETH',
            outputAmount: 20,
            inputAddress: 'btc1address',
            outputAddress: 'eth1address',
            txID: 'tx123',
        });


        assert.throws(() => swap(action), /Failed to parse asset string: "BTCBTC"/);
    });

    test('should correctly map a simple swap', () => {
        const action = createMockAction({
            inputAsset: 'BTC.BTC',
            inputAmount: 1,
            outputAsset: 'ETH.ETH',
            outputAmount: 20,
            inputAddress: 'btc1address',
            outputAddress: 'eth1address',
            txID: 'tx123',
        });

        const result = swap(action);

        assert.equal(result.length, 2);
        assert.equal(result[0].type, CryptoTaxTransactionType.BridgeTradeOut);
        assert.equal(result[1].type, CryptoTaxTransactionType.BridgeTradeIn);

        assert.equal(result[0].description, '1/2 - Swap 1 BTC to 20 ETH; tx123');
        assert.equal(result[0].baseCurrency, 'BTC');
        assert.equal(result[0].baseAmount, '1');
        assert.equal(result[1].description, '2/2 - Swap 1 BTC to 20 ETH; tx123; outbound out-tx123');
        assert.equal(result[1].baseCurrency, 'ETH');
        assert.equal(result[1].baseAmount, '20');
    });

    test('names no outbound txid for a payout to a THORChain or Maya wallet, or one with an all-zero txid', () => {
        const toRune = createMockAction({
            inputAsset: 'BTC.BTC', inputAmount: 1, outputAsset: 'THOR.RUNE', outputAmount: 20,
            inputAddress: 'btc1address', outputAddress: 'thor1address', txID: 'tx123',
        });
        const toCacao = createMockAction({
            inputAsset: 'BTC.BTC', inputAmount: 1, outputAsset: 'MAYA.CACAO', outputAmount: 20,
            inputAddress: 'btc1address', outputAddress: 'maya1address', txID: 'tx123',
        });
        const zeroTxid = createMockAction({
            inputAsset: 'BTC.BTC', inputAmount: 1, outputAsset: 'ETH.ETH', outputAmount: 20,
            inputAddress: 'btc1address', outputAddress: 'eth1address', txID: 'tx123',
        });
        zeroTxid.out[0].txID = '0'.repeat(64);

        assert.equal(swap(toRune)[1].description, '2/2 - Swap 1 BTC to 20 RUNE; tx123');
        assert.equal(swap(toCacao, [], MAYA)[1].description, '2/2 - Swap 1 BTC to 0.2 CACAO; tx123');
        assert.equal(swap(zeroTxid)[1].description, '2/2 - Swap 1 BTC to 20 ETH; tx123');
    });

    test('should use inbound thornode gas instead of Midgard network fee for non-THOR swaps', () => {
        const action = createMockAction({
            inputAsset: 'BTC.BTC',
            inputAmount: 1,
            outputAsset: 'ETH.ETH',
            outputAmount: 20,
            inputAddress: 'btc1address',
            outputAddress: 'eth1address',
            txID: 'tx-gas',
        });

        action.metadata.swap!.networkFees = [{ asset: 'ETH.ETH', amount: '28423' }];

        const result = swap(action, [
            createMockThornodeTx({
                txID: 'tx-gas',
                gasAsset: 'BTC.BTC',
                gasAmount: '3672',
            }) as any,
        ]);

        assert.equal(result[0].feeCurrency, 'BTC');
        assert.equal(result[0].feeAmount, '0.00003672');
    });

    test('should leave fee blank for non-THOR swaps when thornode gas is unavailable', () => {
        const action = createMockAction({
            inputAsset: 'BTC.BTC',
            inputAmount: 1,
            outputAsset: 'ETH.ETH',
            outputAmount: 20,
            inputAddress: 'btc1address',
            outputAddress: 'eth1address',
            txID: 'tx-no-gas',
        });

        action.metadata.swap!.networkFees = [{ asset: 'ETH.ETH', amount: '28423' }];

        const result = swap(action, []);

        assert.equal(result[0].feeCurrency, '');
        assert.equal(result[0].feeAmount, '');
    });

    test('should set USD reference prices when provided by Midgard', () => {
        const action = createMockAction({
            inputAsset: 'BTC.BTC',
            inputAmount: 1,
            outputAsset: 'ETH.ETH',
            outputAmount: 20,
            inputAddress: 'btc1address',
            outputAddress: 'eth1address',
            txID: 'tx124',
        });

        action.metadata.swap!.inPriceUSD = '30000';
        action.metadata.swap!.outPriceUSD = '1500';

        const result = swap(action);

        assert.equal(result[0].referencePricePerUnit, '30000');
        assert.equal(result[0].referencePriceCurrency, 'USD');
        assert.equal(result[1].referencePricePerUnit, '1500');
        assert.equal(result[1].referencePriceCurrency, 'USD');
    });

    test('should handle synth swaps', () => {
        const action = createMockAction({
            inputAsset: 'BTC/BTC',
            inputAmount: 1,
            outputAsset: 'ETH/ETH',
            outputAmount: 20,
            inputAddress: 'thor1address',
            outputAddress: 'thor1address',
            txID: 'tx456',
        });

        const result = swap(action);

        assert.equal(result.length, 2);
        assert.ok(result[0].description!.includes('Synth BTC/BTC'));
        assert.ok(result[1].description!.includes('Synth ETH/ETH'));
        assert.equal(result[0].baseCurrency, 'ThorSynth.BTC.BTC');
        assert.equal(result[1].baseCurrency, 'ThorSynth.ETH.ETH');
        assert.equal(result[0].blockchain, 'THORChain');
        assert.equal(result[1].blockchain, 'THORChain');
        assert.equal(result[0].feeCurrency, 'RUNE');
        assert.equal(result[0].feeAmount, '0.02');
    });

    test('should fall back to default RUNE gas for THOR swaps when thornode gas is unavailable', () => {
        const action = createMockAction({
            inputAsset: 'THOR.RUNE',
            inputAmount: 100,
            outputAsset: 'BTC.BTC',
            outputAmount: 0.01,
            inputAddress: 'thor1address',
            outputAddress: 'bc1address',
            txID: 'tx-thor',
        });

        action.metadata.swap!.networkFees = [{ asset: 'BTC.BTC', amount: '5000' }];

        const result = swap(action, []);

        assert.equal(result[0].feeCurrency, 'RUNE');
        assert.equal(result[0].feeAmount, '0.02');
    });

    test('should fall back to default RUNE gas for trade assets when thornode gas is unavailable', () => {
        const action = createMockAction({
            inputAsset: 'BTC~BTC',
            inputAmount: 1,
            outputAsset: 'ETH.ETH',
            outputAmount: 20,
            inputAddress: 'bc1address',
            outputAddress: 'eth1address',
            txID: 'tx-trade',
        });

        action.metadata.swap!.networkFees = [{ asset: 'ETH.ETH', amount: '28423' }];

        const result = swap(action, []);

        assert.equal(result[0].feeCurrency, 'RUNE');
        assert.equal(result[0].feeAmount, '0.02');
    });

    test('should not fall back to default RUNE gas for token assets when thornode gas is unavailable', () => {
        const action = createMockAction({
            inputAsset: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
            inputAmount: 100,
            outputAsset: 'THOR.RUNE',
            outputAmount: 50,
            inputAddress: '0xuser',
            outputAddress: 'thor1address',
            txID: 'tx-token',
        });

        action.metadata.swap!.networkFees = [{ asset: 'THOR.RUNE', amount: '2000000' }];

        const result = swap(action, []);

        assert.equal(result[0].feeCurrency, '');
        assert.equal(result[0].feeAmount, '');
    });

    test('should throw an error for invalid input', () => {
        const invalidAction: Action = {
            ...createMockAction({
                inputAsset: 'BTC.BTC',
                inputAmount: 1,
                outputAsset: 'ETH.ETH',
                outputAmount: 20,
                inputAddress: 'btc1address',
                outputAddress: 'eth1address',
                txID: 'tx789',
            }),
            in: [],
        };

        assert.throws(() => swap(invalidAction), /swap: expected 1 input but there were 0/);
    });

    test('should ignore synth swaps from non-thor addresses', () => {
        const action = createMockAction({
            inputAsset: 'BTC/BTC',
            inputAmount: 1,
            outputAsset: 'ETH/ETH',
            outputAmount: 20,
            inputAddress: 'btc1address',
            outputAddress: 'eth1address',
            txID: 'tx101112',
        });

        const result = swap(action);

        assert.equal(result.length, 0);
    });

    test('should throw an error for THOR.TOR swaps', () => {
        const action = createMockAction({
            inputAsset: 'BTC.BTC',
            inputAmount: 1,
            outputAsset: 'THOR.TOR',
            outputAmount: 20,
            inputAddress: 'btc1address',
            outputAddress: 'thor1address',
            txID: 'tx131415',
        });

        assert.throws(() => swap(action), /swap: invalid swap - THOR\.TOR/);
    });

    test('should send to the sender when the memo destination is empty', () => {
        const action = createMockAction({
            inputAsset: 'ETH.ETH',
            inputAmount: 1,
            outputAsset: 'ARB.ETH',
            outputAmount: 0.99,
            inputAddress: '0xsameaddress',
            outputAddress: '0xSameAddress',
            txID: 'tx-empty-dest',
        });
        action.metadata.swap!.memo = '=:ARB.ETH:::wr:0';

        const result = swap(action);

        assert.equal(result[1].to, '0xSameAddress');
        assert.equal(result[1].baseAmount, '0.99');
    });

    test('should not treat a same-asset return to the sender as the swap output when the destination is empty', () => {
        const action = createMockAction({
            inputAsset: 'ETH.ETH',
            inputAmount: 1,
            outputAsset: 'ETH.ETH',
            outputAmount: 0.99,
            inputAddress: '0xsameaddress',
            outputAddress: '0xsameaddress',
            txID: 'tx-empty-dest-refund',
        });
        action.metadata.swap!.memo = '=:ARB.ETH:::wr:0';


        assert.throws(() => swap(action), /swap: no matching out tx/);
    });

    test('Maya: a CACAO input without node data falls back to the 0.2 CACAO native fee', () => {
        const action = createMockAction({
            inputAsset: 'MAYA.CACAO',
            inputAmount: 1,
            outputAsset: 'THOR.RUNE',
            outputAmount: 1,
            inputAddress: 'maya1-user',
            outputAddress: 'thor1-user',
            txID: 'tx-cacao',
        });

        const result = swap(action, [], MAYA);

        assert.equal(result[0].feeCurrency, 'CACAO');
        assert.equal(result[0].feeAmount, '0.2');
        assert.equal(result[0].to, 'mayaprotocol');
    });

    test('Maya: a synth swapped from a Maya wallet is the wallet\'s swap, not a savers withdrawal', () => {
        const action = createMockAction({
            inputAsset: 'BTC/BTC',
            inputAmount: 1,
            outputAsset: 'MAYA.CACAO',
            outputAmount: 1,
            inputAddress: 'maya1-user',
            outputAddress: 'maya1-user',
            txID: 'tx-maya-synth',
        });

        const result = swap(action, [], MAYA);

        assert.equal(result.length, 2);
        assert.equal(result[0].blockchain, 'Mayachain');
    });

    test('Maya: a RUNE input still pays THORChain gas', () => {
        const action = createMockAction({
            inputAsset: 'THOR.RUNE',
            inputAmount: 1,
            outputAsset: 'KUJI.KUJI',
            outputAmount: 1,
            inputAddress: 'thor1-user',
            outputAddress: 'kujira1-user',
            txID: 'tx-rune',
        });

        const result = swap(action, [], MAYA);

        assert.equal(result[0].feeCurrency, 'RUNE');
        assert.equal(result[0].feeAmount, '0.02');
    });
});
