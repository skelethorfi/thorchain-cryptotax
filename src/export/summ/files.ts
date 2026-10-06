import {CryptoTaxTransaction} from "./csv";
import {IWallet} from "../../config/IWallet";
import {DateRange, nextDay, startOfDay} from "../../utils/DateRange";

export interface CsvFile {
    name: string;
    rows: CryptoTaxTransaction[];
}

// Which rows go in which CSV file, and how many rows the wallet files hold. Pure: the shell writes the
// files (an empty file is not written) and logs the warnings.
//   all.csv                       every row
//   all-<from>_<to>.csv           every row in the period
//   <from>_<to>_<chain>_<last 5 of address>_<wallet name>.csv
//                                 the period's rows of one wallet, for Summ to import
//   <from>_<to>_THOR_thorchain_swaps.csv
//                                 the period's rows of the 'thorchain' wallet (each from or to it)
// A period's days are calendar days in timeZone (docs/specs/periods.md). Throws when a row in a period lands
// in no wallet file.
export function csvFiles(rows: CryptoTaxTransaction[], ranges: DateRange[], wallets: IWallet[], timeZone: string = 'UTC'): {files: CsvFile[]; exported: number; warnings: string[]} {
    const warnings: string[] = [];
    const files: CsvFile[] = [{name: 'all.csv', rows}];
    const walletExchanges = getUniqueWalletExchanges(rows, warnings);
    let expectedExportCount = 0;
    let count = 0;

    for (const range of ranges) {
        const rangeRows = rows.filter(row => isInRange(row.timestamp, range, timeZone));
        expectedExportCount += rangeRows.length;
        files.push({name: `all-${range.from}_${range.to}.csv`, rows: rangeRows});

        for (const walletExchange of walletExchanges) {
            const walletRows = rangeRows.filter(row => row.walletExchange === walletExchange);

            if (walletRows.length === 0) {
                continue;
            }

            if (walletExchange === 'thorchain') {
                if (walletRows.some(row => row.from !== 'thorchain' && row.to !== 'thorchain')) {
                    throw new Error('bad txs: a thorchain row is neither from nor to thorchain');
                }

                files.push({name: `${range.from}_${range.to}_THOR_thorchain_swaps.csv`, rows: walletRows});
            } else {
                files.push({name: makeFilename(walletExchange, range, wallets, warnings) + '.csv', rows: walletRows});
            }

            count += walletRows.length;
        }
    }

    if (count !== expectedExportCount) {
        throw new Error(`failed to export all txs. expected ${expectedExportCount}, exported ${count}`);
    }

    return {files, exported: count, warnings};
}

// A period runs from midnight at the start of its first day to midnight at the end of its last day, in timeZone
export function isInRange(time: Date, range: DateRange, timeZone: string = 'UTC'): boolean {
    const from = startOfDay(range.from, timeZone);
    const to = startOfDay(nextDay(range.to), timeZone);
    return time.getTime() >= from && time.getTime() < to;
}

function getUniqueWalletExchanges(rows: CryptoTaxTransaction[], warnings: string[]): Set<string> {
    return new Set(rows.map(row => {
        if (!row.walletExchange) {
            warnings.push(`missing walletExchange: ${row.timestamp.toISOString()} ${row.type} ${row.baseAmount} ${row.baseCurrency}`);
            return 'MISSING-ADDRESS';
        }

        return row.walletExchange;
    }));
}

function makeFilename(walletExchange: string, range: DateRange, wallets: IWallet[], warnings: string[]): string {
    const wallet = wallets.find(item => item.address.toLowerCase() === walletExchange.toLowerCase());

    if (!wallet) {
        warnings.push(`wallet not found in config: ${walletExchange}`);
        return `${range.from}_${range.to}_${walletExchange}`;
    }

    // The last 5 characters of the address
    return `${range.from}_${range.to}_${wallet.blockchain}_${wallet.address.slice(-5)}_${wallet.name}`;
}
