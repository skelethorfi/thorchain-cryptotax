import * as path from "path";
import {format} from 'date-fns-tz';
import {Exporter} from "./thorchain-exporter/Exporter";
import {generateReport} from "./thorchain-exporter/Reporter";
import {TaxEvents} from "./thorchain-exporter/TaxEvents";

async function main() {

    console.log(`Current directory: ${process.cwd()}`);

    const args = process.argv.slice(2);

    // --offline: only use what is stored, fail on anything not stored
    const offline = args.includes('--offline');
    // By default a run fetches every wallet's history again (new activity, changed records) and records still
    // pending; anything stored before is kept (docs/specs/snapshots.md). --refetch-all also fetches every
    // finalised record again, e.g. to see what was revised or pruned before filing.
    const fetch = args.includes('--refetch-all') ? 'all' : undefined;
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
    const exporter = new Exporter(configFile, {offline, fetch, replay});

    const outputPath = path.join(exporter.config.outputPath, timestamp);
    const storePath = exporter.config.storePath;

    if (replay) {
        console.log(`Replay: reading the records of ${replay} from ${storePath}\n`);
    } else if (offline) {
        console.log(`Offline: reading only from the store: ${storePath}\n`);
    } else {
        console.log(`Fetching ${fetch === 'all' ? 'every record' : 'the latest data'}; earlier copies in ${storePath} are kept\n`);
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
