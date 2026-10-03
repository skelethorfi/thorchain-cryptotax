import {RecordStore} from '../cache/RecordStore';
import {tcyList} from '../cache/Sources';
import axios from 'axios';
import axiosThrottle from 'axios-request-throttle';
import { API_URLS } from '../config/apiUrls';

const MIDGARD_API_URL = API_URLS.midgard;

axiosThrottle.use(axios, { requestsPerSecond: 1 });

// Interface for TCY distribution item
export interface TcyDistributionItem {
    /**
     * Int64(e8), amount of RUNE distributed to the TCY holder.
     */
    amount: string;
    /**
     * Int64(e8), RUNE price at the time of distribution.
     */
    price: string;
    /**
     * Int64, Unix timestamp for the TCY distribution.
     */
    date: string;
}

// Interface for TCY distribution response
export interface TcyDistribution {
    /**
     * Float, annual percentage rate of the TCY distribution (today's; not stored).
     */
    apr?: string;
    /**
     * Int64(e8), total amount of RUNE distributed to the TCY holder (not stored).
     */
    total?: string;
    /**
     * TCY holder address.
     */
    address: string;
    /**
     * List details of all the TCY distributions.
     */
    distributions: TcyDistributionItem[];
}

export class TcyDistributionService {
    baseUrl: string;

    constructor(private store: RecordStore = new RecordStore('_cache'), private source: string = 'tcy') {
        this.baseUrl = MIDGARD_API_URL;
    }

    // Each distribution is a record (Sources.ts). The response's apr (today's rate) and total are not
    // stored: they change on every fetch and are not used.
    async getTcyDistribution(address: string): Promise<TcyDistribution> {
        const url = `${this.baseUrl}/v2/tcy/distribution/${address}`;
        const distributions = await this.store.list(this.source, address, async () => {
            const response = await axios.get(url);
            return {data: (response.data as TcyDistribution).distributions ?? [], url};
        }, tcyList(address));

        return {address, distributions};
    }
}

async function test() {
    const address = ''; // Example address
    const service = new TcyDistributionService();
    const distribution = await service.getTcyDistribution(address);
    console.log(distribution);
}

if (require.main === module) {
    console.log('Test: ' + __filename);
    test();
}
