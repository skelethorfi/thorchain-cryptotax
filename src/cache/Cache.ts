import fs from 'fs-extra';
import * as path from "path";

export interface CacheOptions {
    // Only read from the cache. A cache miss throws instead of fetching from the network.
    offline?: boolean;
}

export class CacheMissError extends Error {
    constructor(cachePath: string, key: string) {
        super(`Offline: no cached data for '${key}' in ${cachePath}`);
        this.name = 'CacheMissError';
    }
}

export class Cache {
    cachePath: string;
    offline: boolean;

    constructor(cachePath: string, options: CacheOptions = {}) {
        this.cachePath = cachePath;
        this.offline = options.offline ?? false;
    }

    getPathForKey(key: string) {
        return path.join(this.cachePath, key + '.json');
    }

    has(key: string): boolean {
        return fs.existsSync(this.getPathForKey(key));
    }

    read(key: string): any {
        return fs.readJSONSync(this.getPathForKey(key));
    }

    write(key: string, data: any) {
        fs.outputJsonSync(this.getPathForKey(key), data, {spaces: 4});
    }

    clear(key: string) {
        fs.removeSync(this.getPathForKey(key));
    }

    // Call before fetching data for a key that is not cached
    assertCanFetch(key: string) {
        if (this.offline) {
            throw new CacheMissError(this.cachePath, key);
        }
    }
}
