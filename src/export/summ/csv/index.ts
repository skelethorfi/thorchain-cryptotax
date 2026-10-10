// https://help.cryptotaxcalculator.io/en/articles/5777675-advanced-manual-csv-import
// Sample file: docs/reference/advanced.csv

import type {SummRow} from "./SummRow.ts";

export * from './SummCsv.ts';
export * from './SummRow.ts';
export * from './SummRowType.ts';

export function sortNewestFirst(txs: SummRow[]): SummRow[] {
    return txs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
