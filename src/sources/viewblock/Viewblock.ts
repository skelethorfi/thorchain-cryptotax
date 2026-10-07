import {http} from "../http";
import {RecordStore} from "../store/RecordStore";
import {VIEWBLOCK_LIST} from "../store/Sources";
import {ViewblockTx} from "./ViewblockTx";

// Viewblock's THORChain API, used only for sends Midgard does not list, from before 2022-04
// (docs/specs/sends.md). It is unofficial: it answers requests that carry viewblock.io as their Origin, as
// its web pages do, and may change without notice.
const BASE_URL = 'https://api.viewblock.io/thorchain';
const HEADERS = {Origin: 'https://viewblock.io'};

interface Page {
    docs: ViewblockTx[];
    pages: number;
    total: number;
}

export class Viewblock {
    constructor(private store: RecordStore) {
    }

    // Every tx of the address, through the store
    async getTxs(address: string): Promise<ViewblockTx[]> {
        const url = `${BASE_URL}/addresses/${address}/txs?network=mainnet`;
        return this.store.list('viewblock', address, async () => ({data: await this.fetchTxs(url), url}), VIEWBLOCK_LIST);
    }

    private async fetchTxs(url: string): Promise<ViewblockTx[]> {
        const first = await this.page(url, 1);
        const txs = [...first.docs];

        for (let page = 2; page <= first.pages; page++) {
            txs.push(...(await this.page(url, page)).docs);
        }

        if (txs.length !== first.total) {
            throw new Error(`Viewblock listed ${txs.length} txs but reports ${first.total}: ${url}`);
        }

        return txs;
    }

    private async page(url: string, page: number): Promise<Page> {
        return (await http.get<Page>(`${url}&page=${page}`, {headers: HEADERS})).data;
    }
}
