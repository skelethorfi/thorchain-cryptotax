import {Fetched, RecordStore} from "../store/RecordStore";
import {http} from "../http";

// Maya's native transaction fee as set at a height: mimir NATIVETRANSACTIONFEE when set, else the constant. The
// setting has changed over time (docs/specs/maya.md, Fees), and Mayanode serves the state at a past height
// although it has pruned old txs.
export interface NativeFee {
    height: number;
    // CACAO base units (1e10)
    amount: string;
    from: 'mimir' | 'constant';
}

export class MayanodeService {
    constructor(private store: RecordStore, private url: string, private source: string = 'mayanode-fee') {
    }

    // date: of the action the height belongs to, for filing the record
    async nativeFee(height: number, date?: Date): Promise<NativeFee> {
        return this.store.record<NativeFee>(this.source, String(height), () => this.fetchNativeFee(height), {}, date);
    }

    private async fetchNativeFee(height: number): Promise<Fetched<NativeFee>> {
        const mimirUrl = `${this.url}/mayachain/mimir?height=${height}`;
        const mimir = (await http.get(mimirUrl)).data;

        if (mimir.NATIVETRANSACTIONFEE !== undefined) {
            return {data: {height, amount: String(mimir.NATIVETRANSACTIONFEE), from: 'mimir'}, url: mimirUrl};
        }

        const constantsUrl = `${this.url}/mayachain/constants?height=${height}`;
        const constants = (await http.get(constantsUrl)).data;
        return {data: {height, amount: String(constants.int_64_values.NativeTransactionFee), from: 'constant'}, url: constantsUrl};
    }
}
