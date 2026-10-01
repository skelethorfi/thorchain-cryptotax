import fs from "fs-extra";
import path from "path";

// Optional folder outside this repo holding your own configs, caches and outputs, set with
// $TCT_PRIVATE_DIR. Its private values are wallet addresses from its *.toml configs, every
// 64-hex txid found in it, and entries in its private-denylist.txt.

export function getPrivateDir(): string | undefined {
    return process.env.TCT_PRIVATE_DIR || undefined;
}

export class PrivateData {
    readonly patterns: Set<string>;

    constructor(patterns: Iterable<string>) {
        this.patterns = new Set([...patterns].map(p => p.toLowerCase()).filter(p => p.length > 0));
    }

    static load(privateDir: string | undefined = getPrivateDir()): PrivateData {
        if (!privateDir || !fs.existsSync(privateDir)) {
            return new PrivateData([]);
        }

        const patterns: string[] = [];

        for (const file of listFiles(privateDir)) {
            const content = fs.readFileSync(file, 'utf8');

            if (file.endsWith('.toml')) {
                for (const match of content.matchAll(/address\s*=\s*"([^"]+)"/g)) {
                    patterns.push(match[1]);
                }
            }

            if (path.basename(file) === 'private-denylist.txt') {
                patterns.push(...content.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')));
            }

            for (const match of content.matchAll(/\b[0-9A-Fa-f]{64}\b/g)) {
                if (!/^0+$/.test(match[0])) {
                    patterns.push(match[0]);
                }
            }
        }

        return new PrivateData(patterns);
    }

    // Returns the private values found in the text (lower-cased)
    findIn(text: string): string[] {
        const lower = text.toLowerCase();
        return [...this.patterns].filter(pattern => lower.includes(pattern));
    }

    isPrivate(value: string): boolean {
        return this.patterns.has(value.toLowerCase());
    }
}

// Shows enough of a private value to recognise it, without revealing it
export function mask(value: string): string {
    return `${value.slice(0, 8)}… (${value.length} chars)`;
}

function listFiles(dir: string): string[] {
    const files: string[] = [];

    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
            continue;
        }

        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...listFiles(full));
        } else if (/\.(json|csv|toml|txt|md|yaml|yml)$/.test(entry.name)) {
            files.push(full);
        }
    }

    return files;
}
