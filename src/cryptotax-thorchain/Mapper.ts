import { Action } from "@xchainjs/xchain-midgard";
import { CryptoTaxTransaction } from "../cryptotax";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {Protocol} from "../protocols/Protocol";

export interface Mapper {
    // protocol defaults to THORChain
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[], protocol?: Protocol): CryptoTaxTransaction[];
}
