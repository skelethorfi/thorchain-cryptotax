import {describe, expect, jest, test} from '@jest/globals';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {http} from '../src/sources/http';
import {RecordStore} from '../src/sources/store/RecordStore';
import {MayanodeService} from '../src/sources/maya/MayanodeService';

const store = () => new RecordStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-mayanode-')));

describe('MayanodeService native fee', () => {
    test("mimir's setting at the height, else the constant; stored per height", async () => {
        const get = jest.spyOn(http, 'get').mockImplementation(async (url: string) => ({
            data: url.includes('mimir?height=100') ? {NATIVETRANSACTIONFEE: 10000000000}
                : url.includes('mimir') ? {}
                : {int_64_values: {NativeTransactionFee: 2000000000}},
        }) as any);
        const node = new MayanodeService(store(), 'https://node');

        expect(await node.nativeFee(100)).toEqual({height: 100, amount: '10000000000', from: 'mimir'});
        expect(await node.nativeFee(200)).toEqual({height: 200, amount: '2000000000', from: 'constant'});
        expect(get.mock.calls.map(([url]) => url)).toEqual([
            'https://node/mayachain/mimir?height=100',
            'https://node/mayachain/mimir?height=200',
            'https://node/mayachain/constants?height=200',
        ]);
        get.mockRestore();
    });
});
