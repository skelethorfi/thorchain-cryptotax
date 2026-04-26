import { SwapMapper } from '../src/cryptotax-thorchain/SwapMapper';
import { Action, Transaction, Coin } from '@xchainjs/xchain-midgard';
import { describe, expect, test, beforeEach } from '@jest/globals';
import { CryptoTaxTransactionType } from '../src/cryptotax';
import { toMidgardNanoTimestamp } from '../src/cryptotax-thorchain/MidgardUtils';

describe('SwapMapper', () => {
    let swapMapper: SwapMapper;

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
                txID,
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

        swapMapper = new SwapMapper(action, false, []);

        expect(() => swapMapper.toCryptoTax(action, false)).toThrow(
            'Failed to parse asset string: "BTCBTC"'
        );
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false);

        expect(result).toHaveLength(2);
        expect(result[0].type).toBe(CryptoTaxTransactionType.BridgeTradeOut);
        expect(result[1].type).toBe(CryptoTaxTransactionType.BridgeTradeIn);

        expect(result[0].description).toBe('1/2 - Swap 1 BTC to 20 ETH; tx123');
        expect(result[0].baseCurrency).toBe('BTC');
        expect(result[0].baseAmount).toBe('1');
        expect(result[1].description).toBe('2/2 - Swap 1 BTC to 20 ETH; tx123');
        expect(result[1].baseCurrency).toBe('ETH');
        expect(result[1].baseAmount).toBe('20');
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false, [
            createMockThornodeTx({
                txID: 'tx-gas',
                gasAsset: 'BTC.BTC',
                gasAmount: '3672',
            }) as any,
        ]);

        expect(result[0].feeCurrency).toBe('BTC');
        expect(result[0].feeAmount).toBe('0.00003672');
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false, []);

        expect(result[0].feeCurrency).toBe('');
        expect(result[0].feeAmount).toBe('');
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false);

        expect(result[0].referencePricePerUnit).toBe('30000');
        expect(result[0].referencePriceCurrency).toBe('USD');
        expect(result[1].referencePricePerUnit).toBe('1500');
        expect(result[1].referencePriceCurrency).toBe('USD');
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false);

        expect(result).toHaveLength(2);
        expect(result[0].description).toContain('Synth BTC/BTC');
        expect(result[1].description).toContain('Synth ETH/ETH');
        expect(result[0].baseCurrency).toBe('BTC.BTC');
        expect(result[1].baseCurrency).toBe('ETH.ETH');
        expect(result[0].blockchain).toBe('THORChain');
        expect(result[1].blockchain).toBe('THORChain');
        expect(result[0].feeCurrency).toBe('RUNE');
        expect(result[0].feeAmount).toBe('0.02');
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false, []);

        expect(result[0].feeCurrency).toBe('RUNE');
        expect(result[0].feeAmount).toBe('0.02');
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false, []);

        expect(result[0].feeCurrency).toBe('RUNE');
        expect(result[0].feeAmount).toBe('0.02');
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false, []);

        expect(result[0].feeCurrency).toBe('');
        expect(result[0].feeAmount).toBe('');
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

        swapMapper = new SwapMapper(invalidAction, false, []);
        expect(() => swapMapper.toCryptoTax(invalidAction, false)).toThrow(
            'Expected numAssetsIn to be 1 but was 0'
        );
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

        swapMapper = new SwapMapper(action, false, []);
        const result = swapMapper.toCryptoTax(action, false);

        expect(result).toHaveLength(0);
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

        swapMapper = new SwapMapper(action, false, []);
        expect(() => swapMapper.toCryptoTax(action, false)).toThrow(
            'Invalid swap - THOR.TOR'
        );
    });
});
