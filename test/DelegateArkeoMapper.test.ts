import {describe, expect, test} from "@jest/globals";
import fs from 'fs-extra';
import {DelegateArkeoMapper} from "../src/interpret/viewblock/DelegateArkeoMapper";

function getTestData(filename: string) {
    return fs.readJSONSync(`test/testdata/${filename}.json`);
}

describe('DelegateArkeoMapper', () => {
    let mapper: DelegateArkeoMapper;

    test('DelegateArkeo', () => {
        const tx = getTestData('viewblock/DelegateArkeo');
        mapper = new DelegateArkeoMapper(tx, 'thor1-user-wallet-11111');
        const ctc = mapper.toCtc();

        expect(ctc).toStrictEqual([
            {
                "baseAmount": "0.00000001",
                "baseCurrency": "RUNE",
                "blockchain": "THORChain",
                "description": "1/1 - DelegateArkeoWallet; 0000000000000000000000000000000000000000000000000000000000000000",
                "feeAmount": "0.02",
                "feeCurrency": "RUNE",
                "from": "thor1-user-wallet-11111",
                "id": "2020-12-31T13:00:00.000Z.send",
                "timestamp": new Date("2020-12-31T13:00:00.000Z"),
                "to": "thor1-user-wallet-11111",
                "type": "send",
                "walletExchange": "thor1-user-wallet-11111"
            }
        ]);
    });
});
