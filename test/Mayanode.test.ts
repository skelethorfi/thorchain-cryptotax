import {describe, mock, test} from "node:test";
import assert from "node:assert/strict";
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {http} from '../src/sources/http.ts';
import {RecordStore} from '../src/sources/store/RecordStore.ts';
import {MayanodeService} from '../src/sources/maya/MayanodeService.ts';

const store = () => new RecordStore(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-mayanode-')));

describe('MayanodeService native fee', () => {
    test("mimir's setting at the height, else the constant; stored per height", async () => {
        const get = mock.method(http, 'get', async (url: string) => ({
            data: url.includes('mimir?height=100') ? {NATIVETRANSACTIONFEE: 10000000000}
                : url.includes('mimir') ? {}
                : {int_64_values: {NativeTransactionFee: 2000000000}},
        }) as any);
        const node = new MayanodeService(store(), 'https://node');

        assert.deepEqual(await node.nativeFee(100), {height: 100, amount: '10000000000', from: 'mimir'});
        assert.deepEqual(await node.nativeFee(200), {height: 200, amount: '2000000000', from: 'constant'});
        assert.deepEqual(get.mock.calls.map(call => call.arguments[0]), [
            'https://node/mayachain/mimir?height=100',
            'https://node/mayachain/mimir?height=200',
            'https://node/mayachain/constants?height=200',
        ]);
        get.mock.restore();
    });
});
