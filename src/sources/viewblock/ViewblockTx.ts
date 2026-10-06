import {ViewblockMsg} from "./ViewblockTxV2";

export interface ViewblockTx {
    transfers: ViewblockTransfer[];
    _id: string;
    hash: string;
    blockHeight: number;
    extra: ViewblockExtra;
    fee: string;
    timestamp: number;
    type: 'normal';
    addressTypes: {
        [key: string]: 'normal';
    };
    labels: {
        [key: string]: string;
    };
    checksums: any;

    // new
    msgs: ViewblockMsg[];
    types: string[]; // e.g. network | send | main
    memo?: string;
}

export interface ViewblockTransfer {
    from: ViewblockAddress[];
    to: ViewblockAddress[];
}

export interface ViewblockAddress {
    address: string;
    value?: string;
}

export interface ViewblockExtra {
    chain?: string;
    events: ViewblockEvent[];
    gasUsed: string;
    gasWanted: string;
    observedCount: number;
    thorLabels: string[];
    thorOps: any;
    thorMemos: string[];
    thorPools: string[];
    feeAsset: string;
}

export type ViewblockEvent = ViewblockEventSend
    | ViewblockEventDeposit
    | ViewblockEventAddLiquidity;

// export interface ViewblockEvent {
//     name: 'add' | 'deposit' | 'add_liquidity';
//     // params: ViewblockEventParams;
// }

// export interface ViewblockEventParams {
//     fromAddress: string;
//     toAddress: string;
//     poolAsset: string;
//     coins: ViewblockCoin[];
//     memo?: string;
//     signer?: string;
// }

export interface ViewblockEventSend {
    name: 'send',
    fee: {
        amount: {
            denom: string;
            amount: string;
        }[];
        gas: string;
    };
    timeoutHeight?: string;
    data?: string;
    params: {
        fromAddress: string;
        toAddress: string;
        poolAsset: string;
        coins: ViewblockCoin[];
        memo?: string;
        signer?: string;
    }
}

// export interface ViewblockEventAdd {
//     name: 'add',
//
// }

export interface ViewblockEventDeposit {
    name: 'deposit',
    fee: {
        amount: {
            denom: string;
            amount: string;
        }[];
        gas: string;
    };
    timeoutHeight?: string;
    data?: string;
    params: {
        coins: ViewblockCoin[];
        memo?: string;
        signer?: string;
    }
}

export interface ViewblockEventAddLiquidity {
    name: 'add_liquidity';
    params: {
        // eg. AVAX.USDC-0XB97EF9EF8734C71904D8002F8B6BC66DD9C48A6E
        pool: string;
        liquidity_provider_units: string;
        rune_address: string;
        rune_amount: string;
        asset_amount: string;
        asset_address: string;
        THOR_txid?: string;
        BTC_txid?: string;
    }
}

export interface ViewblockCoin {
    asset: string;
    amount: string;
    decimals: string;
}
