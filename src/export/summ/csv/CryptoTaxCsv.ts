import fs from 'fs-extra';
import { CryptoTaxTransaction } from './CryptoTaxTranaction';
import {ctcSortDesc} from "./index";

export const csvMapping = [
    { header: 'Timestamp (UTC)', field: 'timestamp' },
    { header: 'Type', field: 'type' },
    { header: 'Base Currency', field: 'baseCurrency' },
    { header: 'Base Amount', field: 'baseAmount' },
    { header: 'Quote Currency (Optional)', field: 'quoteCurrency' },
    { header: 'Quote Amount (Optional)', field: 'quoteAmount' },
    { header: 'Fee Currency (Optional)', field: 'feeCurrency' },
    { header: 'Fee Amount (Optional)', field: 'feeAmount' },
    { header: 'From (Optional)', field: 'from' },
    { header: 'To (Optional)', field: 'to' },
    { header: 'Blockchain (Optional)', field: 'blockchain' },
    { header: 'ID (Optional)', field: 'id' },
    { header: 'Description (Optional)', field: 'description' },
    { header: 'Reference Price Per Unit (Optional)', field: 'referencePricePerUnit' },
    { header: 'Reference Price Currency (Optional)', field: 'referencePriceCurrency' },
];

function createHeader(): string {
    return csvMapping.map((item) => item.header).join(',') + '\n';
}

export function txToCsv(tx: CryptoTaxTransaction): string {
    return csvMapping
        .map((column) => csvField(formatValue((tx as any)[column.field])))
        .join(',');
}

function formatValue(value: Date | string | undefined): string {
    return value instanceof Date ? value.toISOString() : value ?? '';
}

// Newlines become '; ' so every row stays on one line. A field with a comma or a double quote is
// quoted, with its quotes doubled (RFC 4180); every other field is written as it is.
export function csvField(value: string): string {
    const text = value.replaceAll('\n', '; ');
    return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// The text of one CSV file: the header, then the rows newest first
export function renderCsv(txs: CryptoTaxTransaction[]): string {
    return createHeader() + ctcSortDesc([...txs]).map(txToCsv).join('\n');
}

// Gives every row a unique ID that depends only on its action, so it is the same in every file and every run
// (docs/specs/periods.md): the mapper's `<action time>.<role>`, and for a second row with the same one (two
// actions in one block) `.2`, `.3`, … in the order of the rows' contents
export function assignRowIds(rows: CryptoTaxTransaction[]): CryptoTaxTransaction[] {
    const withIds = rows.map(row => ({...row, id: row.id || `${row.timestamp.toISOString()}.${row.type}`}));
    const byId = new Map<string, CryptoTaxTransaction[]>();
    withIds.forEach(row => byId.set(row.id!, [...byId.get(row.id!) ?? [], row]));

    for (const [id, same] of byId) {
        same.sort((a, b) => txToCsv(a).localeCompare(txToCsv(b))).slice(1).forEach((row, i) => row.id = `${id}.${i + 2}`);
    }

    return withIds;
}

export function writeCsv(
    filename: string,
    txs: CryptoTaxTransaction[]
) {
    if (txs.length === 0) {
        return;
    }

    console.log(`Write CSV: ${filename}`);
    fs.outputFileSync(filename, renderCsv(txs));
}
