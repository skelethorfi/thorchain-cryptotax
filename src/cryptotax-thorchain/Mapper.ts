import { Action } from "@xchainjs/xchain-midgard";
import { CryptoTaxTransaction } from "../cryptotax";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {Protocol} from "../protocols/Protocol";
import {CosmosTx} from "./CosmosTxService";

export interface Mapper {
    // protocol defaults to THORChain. cosmosTxs are given for contract actions (docs/specs/rujira.md)
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[], protocol?: Protocol, cosmosTxs?: CosmosTx[]): CryptoTaxTransaction[];
}
