import {describe, test} from "node:test";
import assert from "node:assert/strict";
import {THORNODE_V1_LAST_HEIGHT, thornodeUrlFor} from "../src/sources/thorchain/ThornodeService.ts";
import {API_URLS} from "../src/config/apiUrls.ts";

describe('thornodeUrlFor', () => {
    test('asks the v1 API for a tx up to its last block', () => {
        assert.equal(thornodeUrlFor(4786560), API_URLS.thornodeArchive);
        assert.equal(thornodeUrlFor(THORNODE_V1_LAST_HEIGHT), API_URLS.thornodeArchive);
    });

    test('asks the current API for a later tx, or one of unknown height', () => {
        assert.equal(thornodeUrlFor(THORNODE_V1_LAST_HEIGHT + 1), API_URLS.thornode);
        assert.equal(thornodeUrlFor(undefined), API_URLS.thornode);
    });
});
