// A THORChain tx as Viewblock's address listing returns it (api.viewblock.io/thorchain/addresses/<address>/txs).
// The listing has no fee; Viewblock's single-tx endpoint does, but sends pay the native fee (docs/specs/sends.md).
export interface ViewblockTx {
    hash: string;
    // Milliseconds since the epoch
    timestamp: number;
    height: number;
    blockIndex: number;
    code: number;
    status: string;       // "success"
    // What Viewblock makes of the tx, e.g. ["network", "send", "main"] or ["swap", "main"]
    types: string[];
    memo?: string;
    signer: string;
    // The coin sent
    input: {
        chain: string;    // "THOR"
        asset: string;    // "THOR.RUNE", "DOGE/DOGE", "TCY"
        amount: string;   // 1e8 units
    };
    msgs: ViewblockMsg[];
}

export interface ViewblockMsg {
    "@type": string;      // one of MSG_SEND_TYPES for a send
    from_address: string;
    to_address: string;
    amount: {
        denom: string;    // "rune"
        amount: string;
    }[];
}

// The message types of a send, before and after the 2022-03 chain upgrade
export const MSG_SEND_TYPES = ['/cosmos.bank.v1beta1.MsgSend', '/types.MsgSend'];
