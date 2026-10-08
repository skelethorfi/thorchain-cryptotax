import {describe, expect, test} from "@jest/globals";
import {THORNODE_V1_LAST_HEIGHT, thornodeUrlFor} from "../src/sources/thorchain/ThornodeService";
import {API_URLS} from "../src/config/apiUrls";

describe('thornodeUrlFor', () => {
    test('asks the v1 API for a tx up to its last block', () => {
        expect(thornodeUrlFor(4786560)).toBe(API_URLS.thornodeArchive);
        expect(thornodeUrlFor(THORNODE_V1_LAST_HEIGHT)).toBe(API_URLS.thornodeArchive);
    });

    test('asks the current API for a later tx, or one of unknown height', () => {
        expect(thornodeUrlFor(THORNODE_V1_LAST_HEIGHT + 1)).toBe(API_URLS.thornode);
        expect(thornodeUrlFor(undefined)).toBe(API_URLS.thornode);
    });
});
