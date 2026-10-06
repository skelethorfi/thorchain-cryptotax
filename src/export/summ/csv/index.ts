// https://help.cryptotaxcalculator.io/en/articles/5777675-advanced-manual-csv-import
// Sample file: docs/reference/advanced.csv

import {CryptoTaxTransaction} from "./CryptoTaxTranaction";

export * from './CryptoTaxCsv';
export * from './CryptoTaxTranaction';
export * from './CryptoTaxTransactionType';

export function ctcSortDesc(txs: CryptoTaxTransaction[]): CryptoTaxTransaction[] {
    return txs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
