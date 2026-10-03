// Fallback when no public tx of the same shape exists: rewrite a private tx so it can't be
// traced back on-chain. Addresses and txids are replaced with placeholders, all amounts
// are scaled by one factor and all dates are shifted by one offset. The output must still
// be reviewed by hand before it is committed.

export interface AnonymiseOptions {
    // Multiplier applied to every amount field (keeps ratios between amounts)
    amountFactor: number;
    // Days added to every date
    dateShiftDays: number;
}

export const DEFAULT_ANONYMISE_OPTIONS: AnonymiseOptions = {amountFactor: 0.731, dateShiftDays: 37};

// Address prefixes, longest first so 'thor1' doesn't swallow 'sthor1'
const ADDRESS_PATTERN = /\b(?:0x[0-9a-fA-F]{40}|(?:thor|sthor|maya|smaya|cosmos|kujira|terra|osmo|bc|ltc|bnb|tb)1[02-9ac-hj-np-z]{20,90}|bitcoincash:q[02-9ac-hj-np-z]{40,}|q[02-9ac-hj-np-z]{40,}|[DLM3][1-9A-HJ-NP-Za-km-z]{25,34})\b/gi;
const TXID_PATTERN = /\b(?:0x)?[0-9A-Fa-f]{64}\b/g;

const AMOUNT_KEYS = new Set(['amount', 'liquidityUnits', 'liquidityFee', 'affiliateFee', 'swapTarget', 'impermanentLossProtection', 'emitAssetE8', 'emitRuneE8', 'collateral', 'debt', 'units', 'networkFee', 'shares']);
const DATE_KEYS = new Set(['date']);
const COIN_KEYS = new Set(['funds', 'amount']);
const COINS_PATTERN = /^\d+[a-z][^,]*(,\d+[a-z][^,]*)*$/i;
// CosmWasm contracts have 32-byte addresses (wallets have 20); they are public, and mappers look them up
const CONTRACT_ADDRESS_PATTERN = /^(thor|maya)1[02-9ac-hj-np-z]{58}$/i;

export class Anonymiser {
    private addresses = new Map<string, string>();
    private txids = new Map<string, string>();

    constructor(private options: AnonymiseOptions = DEFAULT_ANONYMISE_OPTIONS) {
    }

    anonymise<T>(data: T): T {
        return this.walk(data, undefined) as T;
    }

    private walk(value: any, key: string | undefined): any {
        if (Array.isArray(value)) {
            return value.map(item => this.walk(item, key));
        }

        // A Cosmos event attribute: its own key says what the value is
        if (value !== null && typeof value === 'object' && typeof value.key === 'string' && typeof value.value === 'string'
            && Object.keys(value).length === 2) {
            return {key: value.key, value: this.anonymiseString(value.value, value.key)};
        }

        if (value !== null && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.walk(v, k)]));
        }

        if (typeof value === 'string') {
            return this.anonymiseString(value, key);
        }

        return value;
    }

    private anonymiseString(value: string, key: string | undefined): string {
        if (key && AMOUNT_KEYS.has(key) && /^\d+$/.test(value)) {
            return this.scale(value);
        }

        // Coins such as '100x/ruji,20rune' (contract funds, Cosmos transfer amounts)
        if (key && COIN_KEYS.has(key) && COINS_PATTERN.test(value)) {
            return value.replace(/(^|,)(\d+)/g, (_match, sep, amount) => sep + this.scale(amount));
        }

        if (key && DATE_KEYS.has(key) && /^\d{19}$/.test(value)) {
            // Midgard dates are nanoseconds
            return (BigInt(value) + BigInt(this.options.dateShiftDays) * 86_400_000_000_000n).toString();
        }

        return value
            .replace(TXID_PATTERN, match => this.replaceTxid(match))
            .replace(ADDRESS_PATTERN, match => this.replaceAddress(match));
    }

    private scale(amount: string): string {
        return amount === '0' ? amount : Math.max(1, Math.round(Number(amount) * this.options.amountFactor)).toString();
    }

    private replaceTxid(txid: string): string {
        if (/^(0x)?0+$/.test(txid)) {
            return txid;
        }

        const key = txid.toLowerCase().replace(/^0x/, '');

        if (!this.txids.has(key)) {
            this.txids.set(key, (this.txids.size + 1).toString(16).toUpperCase().padStart(64, 'A'));
        }

        return (txid.startsWith('0x') ? '0x' : '') + this.txids.get(key)!;
    }

    private replaceAddress(address: string): string {
        if (CONTRACT_ADDRESS_PATTERN.test(address)) {
            return address;
        }

        const key = address.toLowerCase();

        if (!this.addresses.has(key)) {
            const prefix = key.startsWith('0x') ? '0x' : (key.match(/^[a-z]+1/)?.[0] ?? address[0]);
            this.addresses.set(key, `${prefix}-anon-wallet-${this.addresses.size + 1}`);
        }

        return this.addresses.get(key)!;
    }
}
