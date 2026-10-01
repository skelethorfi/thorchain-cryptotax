import {afterEach, describe, expect, jest, test} from "@jest/globals";

const ENV_VARS = ['THORNODE_API_URL', 'THORNODE_API_ARCHIVE_URL', 'MIDGARD_API_URL'];

const loadApiUrls = () => {
    let apiUrls: any;
    jest.isolateModules(() => {
        apiUrls = require("../src/config/apiUrls").API_URLS;
    });
    return apiUrls;
};

describe('API_URLS', () => {
    const originalEnv = {...process.env};

    afterEach(() => {
        process.env = {...originalEnv};
    });

    test('uses defaults when env vars are not set', () => {
        ENV_VARS.forEach(name => delete process.env[name]);

        expect(loadApiUrls()).toEqual({
            thornode: 'https://gateway.liquify.com/chain/thorchain_api',
            thornodeArchive: 'https://gateway.liquify.com/chain/thorchain_api',
            midgard: 'https://gateway.liquify.com/chain/thorchain_midgard',
        });
    });

    test('uses env vars when set', () => {
        process.env.THORNODE_API_URL = 'https://thornode.example.com';
        process.env.THORNODE_API_ARCHIVE_URL = 'https://archive.example.com';
        process.env.MIDGARD_API_URL = 'https://midgard.example.com';

        expect(loadApiUrls()).toEqual({
            thornode: 'https://thornode.example.com',
            thornodeArchive: 'https://archive.example.com',
            midgard: 'https://midgard.example.com',
        });
    });
});
