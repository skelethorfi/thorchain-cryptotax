import { Action } from "@xchainjs/xchain-midgard";
import { CryptoTaxTransaction } from "../cryptotax";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {Protocol} from "../protocols/Protocol";
import {CosmosTx} from "./CosmosTxService";
import {Issue} from "../domain/Issue";

// A mapper is made for one action; the issues it found are read after toCryptoTax
export interface Mapper {
    issues?: Issue[];
    // protocol defaults to THORChain. cosmosTxs are given for contract actions (docs/specs/rujira.md).
    // addReferencePrices is ignored: CoinMarketCap reference prices were removed
    toCryptoTax(action: Action, addReferencePrices: boolean, thornodeTxs: TxStatusResponse[], protocol?: Protocol, cosmosTxs?: CosmosTx[]): CryptoTaxTransaction[];
}
