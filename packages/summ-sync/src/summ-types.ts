// How a CSV row looks in Summ: the CSV type's leg (side and trade enum), the quote leg of a trade, and
// Summ's id of the row's blockchain.

export type Side = 'incoming' | 'outgoing'

export interface SummType {
    /** The side of the base leg. */
    side: Side
    /** Summ's trade enum of the base leg. */
    trade: string
    /** The trade of the quote leg; only buy and sell keep the quote as a leg of their own. */
    quote?: string
}

const IN = (trade: string): SummType => ({ side: 'incoming', trade })
const OUT = (trade: string): SummType => ({ side: 'outgoing', trade })

// CSV type (Summ's custom CSV import) → Summ's trade enum (edit_transaction). A type missing here stops the plan.
export const SUMM_TYPES: Record<string, SummType> = {
    buy: { side: 'incoming', trade: 'buy', quote: 'sell' },
    sell: { side: 'outgoing', trade: 'sell', quote: 'buy' },
    receive: IN('deposit'),
    send: OUT('withdrawal'),
    fee: OUT('fee'),
    approval: OUT('approval'),
    expense: OUT('expense'),
    lost: OUT('lost'),
    'outgoing-gift': OUT('outgoingGift'),
    income: IN('income'),
    staking: IN('staking'),
    'staking-deposit': OUT('stakingDeposit'),
    'staking-withdrawal': IN('stakingWithdrawal'),
    'bridge-in': IN('bridgeIn'),
    'bridge-out': OUT('bridgeOut'),
    'bridge-trade-in': IN('bridgeTradeIn'),
    'bridge-trade-out': OUT('bridgeTradeOut'),
    'add-liquidity': OUT('addLiquidity'),
    'receive-lp-token': IN('receivingLiquidityProviderToken'),
    'remove-liquidity': IN('removeLiquidity'),
    'return-lp-token': OUT('returningLiquidityProviderToken'),
    'failed-in': IN('failedIn'),
    'failed-out': OUT('failedOut'),
    spam: IN('spamIn'),
    loan: IN('borrow'),
    borrow: IN('borrow'),
    'loan-repayment': OUT('loanRepayment'),
    'collateral-deposit': OUT('collateralDeposit'),
    'collateral-withdrawal': IN('collateralWithdrawal'),
}

export function summType(csvType: string): SummType | undefined {
    return Object.hasOwn(SUMM_TYPES, csvType) ? SUMM_TYPES[csvType] : undefined
}

// The CSV's Blockchain column (lower case) → Summ's blockchain id. A chain missing here is not compared.
export const SUMM_BLOCKCHAINS: Record<string, string> = {
    thorchain: 'thorchain',
    btc: 'btc',
    eth: 'eth',
    ltc: 'ltc',
    doge: 'doge',
    bnb: 'binancechain',
}

export function summBlockchain(csvBlockchain: string): string | undefined {
    const key = csvBlockchain.toLowerCase()
    return Object.hasOwn(SUMM_BLOCKCHAINS, key) ? SUMM_BLOCKCHAINS[key] : undefined
}
