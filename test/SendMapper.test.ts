import {describe, expect, test} from "@jest/globals";
import fs from 'fs-extra';
import {SendMapper} from "../src/thorchain-exporter/SendMapper";

function getTestData(filename: string) {
    return fs.readJSONSync(`test/testdata/${filename}.json`);
}

describe('SendMapper', () => {
    let mapper: SendMapper;

    test('Send Synth DOGE', () => {
        const tx = getTestData('viewblock/Send_SynthDOGE');
        mapper = new SendMapper(tx, 'thor1-user-wallet-11111');
        const ctc = mapper.toCtc();

        expect(ctc).toStrictEqual([
            {
                "baseAmount": "1.23",
                "baseCurrency": "DOGE",
                "blockchain": "THOR",
                "description": "Send 1.23 Synth DOGE; 0000000000000000000000000000000000000000000000000000000000000000",
                "feeAmount": "0.02",
                "feeCurrency": "RUNE",
                "from": "thor1-user-wallet-11111",
                "id": "2020-12-31T13:00:00.000Z.send",
                "timestamp": "2020-12-31T13:00:00.000Z",
                "to": "thor1-user-wallet-22222",
                "type": "send",
                "walletExchange": "thor1-user-wallet-11111"
            }
        ]);
    });

    test('should error on incorrect asset string', () => {
        let tx = getTestData('viewblock/Send_SynthDOGE');

        // Set invalid asset string
        tx.input.asset = "DOGEDOGE";

        mapper = new SendMapper(tx, 'thor1-user-wallet-11111');

        expect(() => mapper.toCtc()).toThrow(
            '[Viewblock] Failed to parse asset string "DOGEDOGE". type: send, txid: 0000000000000000000000000000000000000000000000000000000000000000'
        );
    });

    test('send 0.00000001 RUNE to self for arkeo wallet delegation', () => {
        const tx: any = {
            "blockIndex": 0,
            "code": 0,
            "height": 10000000,
            "input": {
                "chain": "THOR",
                "asset": "THOR.RUNE",
                "amount": "1",
                "type": null,
                "usdNew": "0.00000001",
                "usd": "0"
            },
            "memo": "delegate:arkeo:arkeo1-user-wallet-11111",
            "msgs": [
                {
                    "@type": "/types.MsgSend",
                    "from_address": "thor1-user-wallet-11111",
                    "to_address": "thor1-user-wallet-11111",
                    "amount": [
                        {
                            "denom": "rune",
                            "amount": "1"
                        }
                    ]
                }
            ],
            "signer": "thor1-user-wallet-11111",
            "status": "success",
            "timestamp": 1609419600000,
            "types": [
                "network",
                "send",
                "main"
            ],
            "hash": "0000000000000000000000000000000000000000000000000000000000000000"
        };

        mapper = new SendMapper(tx, 'thor1-user-wallet-11111');
        const ctc = mapper.toCtc();

        expect(ctc).toStrictEqual([
            {
                "baseAmount": "0.00000001",
                "baseCurrency": "RUNE",
                "blockchain": "THOR",
                "description": "Send 0.00000001 RUNE; 0000000000000000000000000000000000000000000000000000000000000000",
                "feeAmount": "0.02",
                "feeCurrency": "RUNE",
                "from": "thor1-user-wallet-11111",
                "id": "2020-12-31T13:00:00.000Z.send",
                "timestamp": "2020-12-31T13:00:00.000Z",
                "to": "thor1-user-wallet-11111",
                "type": "send",
                "walletExchange": "thor1-user-wallet-11111"
            }
        ]);
    });

    test('send 0.00000001 RUNE to self for arkeo wallet delegation (alternate @type)', () => {
        const tx: any = {
            "blockIndex": 0,
            "code": 0,
            "height": 10000000,
            "input": {
                "chain": "THOR",
                "asset": "THOR.RUNE",
                "amount": "1",
                "type": null,
                "usdNew": "0.00000001",
                "usd": "0"
            },
            "memo": "delegate:arkeo:arkeo1-user-wallet-11111",
            "msgs": [
                {
                    "@type": "/cosmos.bank.v1beta1.MsgSend",
                    "from_address": "thor1-user-wallet-11111",
                    "to_address": "thor1-user-wallet-11111",
                    "amount": [
                        {
                            "denom": "rune",
                            "amount": "1"
                        }
                    ]
                }
            ],
            "signer": "thor1-user-wallet-11111",
            "status": "success",
            "timestamp": 1609419600000,
            "types": [
                "network",
                "send",
                "main"
            ],
            "hash": "0000000000000000000000000000000000000000000000000000000000000000"
        };

        mapper = new SendMapper(tx, 'thor1-user-wallet-11111');
        const ctc = mapper.toCtc();

        expect(ctc).toStrictEqual([
            {
                "baseAmount": "0.00000001",
                "baseCurrency": "RUNE",
                "blockchain": "THOR",
                "description": "Send 0.00000001 RUNE; 0000000000000000000000000000000000000000000000000000000000000000",
                "feeAmount": "0.02",
                "feeCurrency": "RUNE",
                "from": "thor1-user-wallet-11111",
                "id": "2020-12-31T13:00:00.000Z.send",
                "timestamp": "2020-12-31T13:00:00.000Z",
                "to": "thor1-user-wallet-11111",
                "type": "send",
                "walletExchange": "thor1-user-wallet-11111"
            }
        ]);
    });

    test('Send TCY', () => {
        const tx = getTestData('viewblock/Send_TCY');
        mapper = new SendMapper(tx, 'thor1-user-wallet-11111');
        const ctc = mapper.toCtc();

        expect(ctc).toStrictEqual([
            {
                "baseAmount": "10000",
                "baseCurrency": "TCY",
                "blockchain": "THOR",
                "description": "Send 10000 TCY; 0000000000000000000000000000000000000000000000000000000000000000",
                "feeAmount": "0.02",
                "feeCurrency": "RUNE",
                "from": "thor1-user-wallet-11111",
                "id": "2020-12-31T13:00:00.000Z.send",
                "timestamp": "2020-12-31T13:00:00.000Z",
                "to": "thor1-user-wallet-22222",
                "type": "send",
                "walletExchange": "thor1-user-wallet-11111"
            }
        ]);
    });
});
