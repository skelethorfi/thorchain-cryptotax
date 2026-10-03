import * as path from "path";
import {format} from 'date-fns-tz';
import {Exporter} from "./thorchain-exporter/Exporter";
import {generateReport} from "./thorchain-exporter/Reporter";
import {TaxEvents} from "./thorchain-exporter/TaxEvents";

async function main() {

    console.log(`Current directory: ${process.cwd()}`);

    const args = process.argv.slice(2);

    // --offline: only use cached data sources, fail on anything not cached
    const offline = args.includes('--offline');
    // --refresh: fetch each wallet's data again; changes are saved as new snapshots (docs/specs/snapshots.md)
    const refresh = args.includes('--refresh');
    // --replay <run folder>: read exactly the snapshots that run used
    const replayIndex = args.indexOf('--replay');
    const replay = replayIndex >= 0 ? args[replayIndex + 1] : undefined;

    if (replayIndex >= 0 && !replay) {
        throw new Error('--replay needs a run folder');
    }

    // Get the last non-flag argument as the config filename
    const configFile = args.filter(arg => !arg.startsWith('--') && arg !== replay).pop() ?? '';

    if (!configFile.endsWith('.json') && !configFile.endsWith('.toml')) {
        throw new Error('must specify config file');
    }

    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');

    // Read config
    const exporter = new Exporter(configFile, {offline, refresh, replay});

    const outputPath = path.join(exporter.config.outputPath, timestamp);
    const cachePath = exporter.config.cachePath;

    if (replay) {
        console.log(`Replay: reading the snapshots of ${replay} from ${cachePath}\n`);
    } else if (offline) {
        console.log(`Offline: reading only from cache: ${cachePath}\n`);
    } else if (refresh || !exporter.config.cacheDataSources) {
        console.log(`Refresh: fetching each wallet's data again; earlier snapshots in ${cachePath} are kept\n`);
    }

    const wallets = exporter.config.wallets;
    const allEvents = new TaxEvents();

    // Import viewblock and midgard into TaxEvents

    for (const wallet of wallets) {
        const events = await exporter.getEvents(wallet, outputPath);
        events.sortDesc();

        // Generate each report with the events for that wallet only.
        // After calling addEvents then events will be de-duplicated so not all would show up in their wallet report.
        generateReport(events, wallet, path.join(outputPath, 'report'));

        allEvents.addEvents(events);
    }

    allEvents.sortDesc();

    // Convert TaxEvents to CTC
    // Collect all events and then save, otherwise one wallet's TC swaps could overwrite another
    exporter.saveToCsv(allEvents.getAllCtcTx(), path.join(outputPath, 'csv'));

    // Which snapshot of each source this run used, for --replay
    exporter.snapshots.write(outputPath);
}

main().then(() => {
    process.exit(0);
});
