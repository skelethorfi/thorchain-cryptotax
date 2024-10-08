import * as path from "path";
import fs from "fs-extra";
import {format} from 'date-fns-tz';
import {Exporter} from "./thorchain-exporter/Exporter";
import {generateReport} from "./thorchain-exporter/Reporter";
import {TaxEvents} from "./thorchain-exporter/TaxEvents";

async function main() {

    console.log(`Current directory: ${process.cwd()}`);

    // Get the last argument as the config filename
    const configFile = process.argv[process.argv.length - 1];

    if (!configFile.endsWith('.json') && !configFile.endsWith('.toml')) {
        throw new Error('must specify config file');
    }

    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const outputPath = `output/${timestamp}`;
    const cachePath = 'cache';

    // Read config
    const exporter = new Exporter(path.resolve(configFile), path.resolve(cachePath));

    if (!exporter.config.cacheDataSources) {
        // Delete all cached data sources
        console.log(`Removing cache: ${path.resolve(cachePath)}\n`);
        fs.removeSync(cachePath);
    }

    const wallets = exporter.config.wallets;
    const allEvents= new TaxEvents();

    // Import viewblock and midgard into TaxEvents

    for (const wallet of wallets) {
        const events = await exporter.getEvents(wallet);
        events.sortDesc();

        // Generate each report with the events for that wallet only.
        // After calling addEvents then events will be de-duplicated so not all would show up in their wallet report.
        generateReport(events, wallet, `${outputPath}/report`);

        allEvents.addEvents(events);
    }

    allEvents.sortDesc();

    // Convert TaxEvents to CTC
    // Collect all events and then save, otherwise one wallet's TC swaps could overwrite another
    exporter.saveToCsv(allEvents.getAllCtcTx(), `${outputPath}/csv`);
}

main().then(() => {
    process.exit(0);
});
