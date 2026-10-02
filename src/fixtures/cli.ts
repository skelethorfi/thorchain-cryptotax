import fs from "fs-extra";
import os from "os";
import path from "path";
import {Action, Configuration, MidgardApi} from "@xchainjs/xchain-midgard";
import {ThornodeService} from "../cryptotax-thorchain/ThornodeService";
import {getThornodeTxIds} from "../thorchain-exporter/Exporter";
import {Anonymiser} from "./Anonymise";
import {EXPECTED_FILE, formatRows, GoldenCaseInput, INPUT_FILE, readCaseInput, runCase, writeCaseExpected} from "./GoldenCase";
import {getPrivateDir, mask, PrivateData} from "./PrivateData";
import {describeShape, getActionIds, getActionShape, sameShape} from "./Shape";
import {getProtocol, Protocol, THORCHAIN} from "../protocols/Protocol";

// Workflow for adding a golden test case without leaking private data:
//
// Set TCT_PRIVATE_DIR to a folder outside the repo holding your own configs and caches,
// so the tool can refuse to write cases containing your addresses or txids.
//
//   fetch <txid>                 save a (possibly private) tx into the private folder (or --out)
//   similar <input.json>         find public txs with the same shape
//   add <txid> <group/name>      fetch a public tx into test/cases (refuses private data)
//   anonymise <input.json> <group/name>   fallback: anonymised copy of a private tx
//   show <case-dir> [--write]    print the mapped rows; --write saves expected.yaml after review
//
// fetch, similar and add take --protocol maya for Maya Protocol txs (default thorchain).

const CASES_DIR = path.resolve(__dirname, '../../test/cases');
const midgardFor = (protocol: Protocol) => new MidgardApi(new Configuration({basePath: protocol.midgardUrl}));

async function fetchInput(txid: string, protocol: Protocol, index?: number): Promise<GoldenCaseInput> {
    const response = await midgardFor(protocol).getActions(undefined, txid);
    const actions = response.data.actions;

    if (actions.length === 0) {
        throw new Error(`no Midgard action for txid ${mask(txid)}`);
    }

    if (actions.length > 1 && index === undefined) {
        actions.forEach((action, i) => console.error(`  [${i}] ${describeShape(getActionShape(action))}`));
        throw new Error(`${actions.length} actions for this txid; choose one with --index`);
    }

    const action = actions[index ?? 0];
    const thornodeTxs = [];

    const thornodeTxIds = protocol === THORCHAIN ? getThornodeTxIds(action) : [];

    if (thornodeTxIds.length) {
        const thornode = new ThornodeService(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ct-thornode-')));

        for (const txId of thornodeTxIds) {
            thornodeTxs.push(await thornode.getTxStatus(txId));
        }
    }

    return {
        description: describeShape(getActionShape(action)),
        source: 'midgard',
        ...(protocol === THORCHAIN ? {} : {protocol: protocol.id}),
        wallet: action.in[0]?.address ?? '',
        data: action,
        ...(thornodeTxs.length ? {thornodeTxs} : {}),
    };
}

async function findSimilar(input: GoldenCaseInput, maxPages: number, privateData: PrivateData): Promise<Action[]> {
    const midgard = midgardFor(getProtocol(input.protocol));
    const target = input.data as Action;
    const shape = getActionShape(target);
    const asset = shape.inAssets[0]?.[0];
    const matches: Action[] = [];
    // Search backwards from the original tx's block, so the API format is from the same era.
    // (Querying by height is fast; by timestamp it times out on the Liquify gateway.)
    let nextPageToken: number | undefined;
    const height = Number(target.height);

    for (let page = 0; page < maxPages && matches.length < 5; page++) {
        const response = await midgard.getActions(undefined, undefined, shape.type === 'contract' ? undefined : asset, shape.type,
            undefined, undefined, 50, undefined, nextPageToken, undefined, nextPageToken ? undefined : height);

        for (const action of response.data.actions) {
            const isPrivate = getActionIds(action).some(id => privateData.isPrivate(id));

            if (!isPrivate && sameShape(getActionShape(action), shape)) {
                matches.push(action);
            }
        }

        nextPageToken = Number(response.data.meta.nextPageToken) || undefined;

        if (!nextPageToken) {
            break;
        }
    }

    return matches;
}

function assertNoPrivateData(input: GoldenCaseInput, privateData: PrivateData) {
    const found = privateData.findIn(JSON.stringify(input));

    if (found.length > 0) {
        found.forEach(value => console.error(`  private: ${mask(value)}`));
        throw new Error('refusing to write a test case containing private data');
    }
}

function writeCase(name: string, input: GoldenCaseInput) {
    const dir = path.join(CASES_DIR, name);

    if (fs.existsSync(path.join(dir, INPUT_FILE))) {
        throw new Error(`case already exists: ${path.relative(process.cwd(), dir)}`);
    }

    fs.outputJsonSync(path.join(dir, INPUT_FILE), input, {spaces: 2});
    console.log(`Wrote ${path.relative(process.cwd(), path.join(dir, INPUT_FILE))}`);
    show(dir, false);
}

function show(dir: string, write: boolean) {
    const rows = runCase(readCaseInput(dir));
    console.log(formatRows(rows));

    if (write) {
        writeCaseExpected(dir, rows);
        console.log(`Wrote ${path.relative(process.cwd(), path.join(dir, EXPECTED_FILE))}`);
    } else {
        console.log(`\nReview these rows against the spec. If they are right: npm run fixture -- show ${path.relative(process.cwd(), dir)} --write`);
    }
}

function getFlag(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
    const [command, ...args] = process.argv.slice(2);
    const positional = args.filter((arg, i) => !arg.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--write'));
    const index = getFlag(args, '--index');
    const protocol = getProtocol(getFlag(args, '--protocol'));
    const privateData = PrivateData.load();

    if (['add', 'anonymise', 'similar'].includes(command) && !getPrivateDir()) {
        console.error('Warning: TCT_PRIVATE_DIR is not set, so cases are not checked for your own addresses and txids.');
    }

    switch (command) {
        case 'fetch': {
            const [txid] = positional;
            const input = await fetchInput(txid, protocol, index === undefined ? undefined : Number(index));
            const privateDir = getPrivateDir();
            const out = getFlag(args, '--out') ?? (privateDir && path.join(privateDir, 'fixtures', txid, INPUT_FILE));

            if (!out) {
                throw new Error('set TCT_PRIVATE_DIR or pass --out <file>; fetched txs may be private, so they are not written into the repo');
            }

            fs.outputJsonSync(out, input, {spaces: 2});
            console.log(`${input.description}\nWrote ${out}`);
            break;
        }
        case 'similar': {
            const [file] = positional;
            const input: GoldenCaseInput = fs.readJSONSync(file);
            console.log(`Looking for: ${describeShape(getActionShape(input.data as Action))}`);
            const matches = await findSimilar(input, Number(getFlag(args, '--pages') ?? 10), privateData);

            for (const action of matches) {
                console.log(`${new Date(Number(BigInt(action.date) / 1_000_000n)).toISOString()} ${action.in[0]?.txID}`);
            }

            if (matches.length === 0) {
                console.log('No public tx with the same shape found. Try --pages, or use anonymise.');
            }
            break;
        }
        case 'add': {
            const [txid, name] = positional;

            if (privateData.isPrivate(txid)) {
                throw new Error('that txid is private; use similar or anonymise');
            }

            const input = await fetchInput(txid, protocol, index === undefined ? undefined : Number(index));
            assertNoPrivateData(input, privateData);
            writeCase(name, input);
            break;
        }
        case 'anonymise': {
            const [file, name] = positional;
            const input: GoldenCaseInput = new Anonymiser().anonymise(fs.readJSONSync(file));
            input.description = `${input.description} (anonymised)`;
            assertNoPrivateData(input, privateData);
            writeCase(name, input);
            break;
        }
        case 'show': {
            const [dir] = positional;
            show(path.resolve(dir), args.includes('--write'));
            break;
        }
        default:
            console.log('usage: npm run fixture -- <fetch|similar|add|anonymise|show> ...  (see src/fixtures/cli.ts)');
            process.exitCode = 1;
    }
}

main().catch(error => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});
