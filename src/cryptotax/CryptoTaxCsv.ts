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
        .map((column) => csvField((tx as any)[column.field] ?? ''))
        .join(',');
}

// Newlines become '; ' so every row stays on one line. A field with a comma or a double quote is
// quoted, with its quotes doubled (RFC 4180); every other field is written as it is.
export function csvField(value: string): string {
    const text = value.replaceAll('\n', '; ');
    return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// The text of one CSV file: the header, then the rows newest first, each with the ID
// `<fileName>:<n>`, numbered from the oldest row up
export function renderCsv(txs: CryptoTaxTransaction[], fileName: string): string {
    const rows = ctcSortDesc(txs.map(tx => ({...tx})));
    rows.forEach((tx, i) => tx.id = `${fileName}:${rows.length - i}`);
    return createHeader() + rows.map(txToCsv).join('\n');
}

export function writeCsv(
    filename: string,
    txs: CryptoTaxTransaction[]
) {
    if (txs.length === 0) {
        return;
    }

    console.log(`Write CSV: ${filename}`);
    fs.outputFileSync(filename, renderCsv(txs, filename.split('/').pop() ?? filename));
}
