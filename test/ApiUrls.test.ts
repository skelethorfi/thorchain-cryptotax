import {afterEach, describe, test} from "node:test";
import assert from "node:assert/strict";

const ENV_VARS = ['THORNODE_API_URL', 'THORNODE_API_ARCHIVE_URL', 'MIDGARD_API_URL'];

// A fresh copy of the module each time (a new URL is a new module), so it reads the env again
let loads = 0;
const loadApiUrls = async () => (await import(`../src/config/apiUrls.ts?load=${++loads}`)).API_URLS;

describe('API_URLS', () => {
    const originalEnv = {...process.env};

    afterEach(() => {
        process.env = {...originalEnv};
    });

    test('uses defaults when env vars are not set', async () => {
        ENV_VARS.forEach(name => delete process.env[name]);

        assert.deepEqual(await loadApiUrls(), {
            thornode: 'https://gateway.liquify.com/chain/thorchain_api',
            thornodeArchive: 'https://gateway.liquify.com/chain/thorchain_v1_api',
            midgard: 'https://gateway.liquify.com/chain/thorchain_midgard',
        });
    });

    test('uses env vars when set', async () => {
        process.env.THORNODE_API_URL = 'https://thornode.example.com';
        process.env.THORNODE_API_ARCHIVE_URL = 'https://archive.example.com';
        process.env.MIDGARD_API_URL = 'https://midgard.example.com';

        assert.deepEqual(await loadApiUrls(), {
            thornode: 'https://thornode.example.com',
            thornodeArchive: 'https://archive.example.com',
            midgard: 'https://midgard.example.com',
        });
    });
});
