// https://help.cryptotaxcalculator.io/en/articles/5777675-advanced-manual-csv-import
// Sample file: docs/reference/advanced.csv

import type {CryptoTaxTransaction} from "./CryptoTaxTranaction.ts";

export * from './CryptoTaxCsv.ts';
export * from './CryptoTaxTranaction.ts';
export * from './CryptoTaxTransactionType.ts';

export function ctcSortDesc(txs: CryptoTaxTransaction[]): CryptoTaxTransaction[] {
    return txs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
