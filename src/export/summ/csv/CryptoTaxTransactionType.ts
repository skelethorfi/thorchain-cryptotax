/**
 * Advanced Custom CSV Import
 * https://help.cryptotaxcalculator.io/en/articles/5777675-advanced-custom-csv-import
 *
 * For non-trade transactions, you must fill in the first four columns:
 * - Timestamp (UTC)
 * - Type
 * - Base Currency
 * - Base Amount
 *
 * For trade (buy and sell) transactions, you must fill in the first six columns:
 * - Timestamp (UTC)
 * - Type
 * - Base Currency
 * - Base Amount
 * - Quote Currency
 * - Quote Amount
 */
export enum CryptoTaxTransactionType {
    /**
     * Unspecified transaction type.
     * This is used when the transaction type is not specified or cannot be determined.
     * Not a valid Crypto Tax Calculator type.
     */
    Unspecified = 'unspecified',

    /**
     * Purchase of cryptocurrency, which increases the balance remaining and effects cost basis.
     */
    Buy = 'buy',

    /**
     * A sale of cryptocurrency which decreases the balance remaining and triggers a capital gain event.
     */
    Sell = 'sell',

    /**
     * A deposit of your local currency into the exchange.
     * Note that if you deposit a currency other than your local currency, you need to have a corresponding buy transaction of that currency.
     * (e.g. if your country setting is AU, there should be AUD->USD transactions imported as USD is foreign currency for AU.)
     */
    FiatDeposit = 'fiat-deposit',

    /**
     * Use this if you cashed out from an exchange into your bank account.
     */
    FiatWithdrawal = 'fiat-withdrawal',

    /**
     * Use this if you have disposed of cryptocurrency to cover fee transactions generated as a result of other transactions,
     * e.g., gas fees paid during on-chain Ethereum swaps. If using this category, don't include this fee amount in the fee column.
     */
    Fee = 'fee',

    /**
     * You approved the use of a smart contract. This is taxed the same way as a Fee, a disposal event.
     * This category is listed in the Miscellaneous Expense Report.
     */
    Approval = 'approval',

    /**
     * A transfer of cryptocurrency to a wallet or exchange.
     * Increases the balance remaining on the receiving address and decreases the balance remaining on the from address.
     * Does not increase your overall balance remaining.
     * Does not trigger a capital gain event.
     */
    Receive = 'receive',
    TransferIn = 'transfer-in',

    /**
     * A transfer of cryptocurrency from a wallet or exchange.
     * Increases the balance remaining on the receiving address and decreases the balance remaining on the from address.
     * Does not decrease your overall balance remaining.
     * Does not trigger a capital gain event.
     */
    Send = 'send',
    TransferOut = 'transfer-out',

    /**
     * Use this if you acquired a new cryptocurrency as a result of a chain split (such as Bitcoin Cash being received by Bitcoin holders).
     */
    ChainSplit = 'chain-split',

    /**
     * This acts similar to a Sell. However you wish to label this as an expense.
     * You can use this if you want to categorize an outgoing transaction as an expense (e.g. business paying out a salary).
     * This category is listed in the Miscellaneous Expense Report.
     */
    Expense = 'expense',

    /**
     * Triggers a capital loss event with the sale price being zero.
     */
    Stolen = 'stolen',

    /**
     * Use this if you have lost the crypto, triggers a capital loss event similar to the stolen category.
     */
    Lost = 'lost',

    /**
     * Use this if you have sent your crypto / NFT to a burner address. It triggers a capital loss event similar to the stolen category.
     */
    Burn = 'burn',

    /**
     * Triggers an income tax event based on the market value at the time of receipt.
     * Increase the balance remaining and is used for future cost basis calculations.
     */
    Income = 'income',

    /**
     * Similar to income but used for interest-bearing activities which don't suit other categories.
     */
    Interest = 'interest',

    /**
     * Use this if you received mining rewards (as a hobby).
     */
    Mining = 'mining',

    /**
     * Use this if you received a free token airdrop.
     */
    Airdrop = 'airdrop',

    /**
     * Use this if you earned interest from staking.
     */
    Staking = 'staking',

    /**
     * You deposited these coins into a staking pool. This acts similar to a withdrawal.
     */
    StakingDeposit = 'staking-deposit',

    /**
     * You have withdrawn these coins from the staking pool. This acts similar to a deposit.
     */
    StakingWithdrawal = 'staking-withdrawal',

    /**
     * Use this if you acquired a fee refund from trading and/or cryptocurrency as a cash-back (e.g., credit card payment).
     */
    Rebate = 'rebate',

    /** Use this if you acquired cryptocurrency as a cash-back (e.g., credit card payment). */
    Cashback = 'cashback',

    /**
     * Use this if you have received payments from secondary sales (e.g., being an NFT creator).
     */
    Royalty = 'royalty',
    Royalties = 'royalties',

    /**
     * Use this if you spent crypto on personal use and you want to ignore this transaction for tax purposes.
     * Warning, this is only valid in very specific individual circumstances. Check with your tax professional before using this option.
     */
    PersonalUse = 'personal-use',

    /**
     * Use this if you have acquired cryptocurrency as a gift. If you have given a gift to someone else, use the sell category.
     */
    IncomingGift = 'incoming-gift',
    Gift = 'gift',

    /**
     * Use this If you have given a gift to someone else. This is similar to a sell.
     */
    OutgoingGift = 'outgoing-gift',

    /**
     * Use this if you have received (acquired) a cryptocurrency or cash as a loan.
     */
    Borrow = 'borrow',
    Loan = 'loan',

    /**
     * Use this if you have repaid a loan.
     */
    LoanRepayment = 'loan-repayment',

    /**
     * Use this if the lending platform you used has liquidated your collateral.
     */
    Liquidate = 'liquidate',

    /**
     * Used to transfer the cost basis from one blockchain to another.
     * Note: A "bridge-in" must match a "bridge-out".
     *
     * bridge-out is the send transaction from the source wallet.
     * bridge-in is the receive transaction in the destination wallet.
     */
    BridgeIn = 'bridge-in',
    BridgeOut = 'bridge-out',

    /**
     * This acts similar to a 'buy'. A common use case is when a user is minting NFTs.
     */
    Mint = 'mint',

    /**
     * You have withdrawn these coins from a borrowing/lending platform. This acts similar to a deposit into your account.
     */
    CollateralWithdrawal = 'collateral-withdrawal',

    /**
     * You have set these coins aside as collateral for a loan. This acts as a withdrawal from your account.
     */
    CollateralDeposit = 'collateral-deposit',

    /**
     * You have added these coins into a liquidity pool
     */
    AddLiquidity = 'add-liquidity',

    /**
     * You have received tokens for adding coins into a liquidity pool.
     */
    ReceiveLpToken = 'receive-lp-token',

    /**
     * You have removed these coins from a liquidity pool.
     */
    RemoveLiquidity = 'remove-liquidity',

    /**
     * You have returned tokens for removing coins from a liquidity pool.
     */
    ReturnLpToken = 'return-lp-token',

    /**
     * A failed transaction. This will be ignored from tax and balance calculations.
     * (Note: Any fees incurred from creating the transaction will be accounted for.)
     */
    FailedIn = 'failed-in',
    FailedOut = 'failed-out',

    /**
     * Mark the transactions as spam and ignore them from tax and balance calculations.
     */
    Spam = 'spam',

    /**
     * To account for a non-taxable transaction where one asset is traded for another.
     * It works by assigning the cost basis and purchase date of the original asset to the new one.
     * (NOTE: If you are a UK user using the HMRC inventory method, 'swap' is currently not supported. Please use 'buy/sell'.)
     */
    SwapIn = 'swap-in',
    SwapOut = 'swap-out',

    /**
     * You received crypto on a blockchain from a trade initiated on a different blockchain.
     * This is the incoming side of a cross-chain trade.
     */
    BridgeTradeIn = 'bridge-trade-in',

    /**
     * You traded crypto on one blockchain and sent it to another blockchain via a bridge.
     * This is the outgoing side of a cross-chain trade.
     */
    BridgeTradeOut = 'bridge-trade-out',

    // Derivative Categories

    /**
     * Use this if you have performed margin, futures, derivates, etc. type trades and realized a profit from your trading activity.
     */
    RealizedProfit = 'realized-profit',

    /**
     * Use this if you have performed margin, futures, derivates, etc., type trades, and realized a loss of your trading activity.
     */
    RealizedLoss = 'realized-loss',

    /**
     * Use this if you have paid fees associated with a realized-profit or realized-loss trades.
     */
    MarginFee = 'margin-fee',

    /**
     * You opened or increased a position by investing crypto from your account (for derivatives).
     */
    OpenPosition = 'open-position',

    /**
     * You closed or reduced a position and received returns into your account (for derivatives).
     */
    ClosePosition = 'close-position',

    /**
     * You opened or increased a position and received a position token (for derivatives).
     */
    ReceivePq = 'receive-pq',

    /**
     * You closed or reduced a position by returning the position token (for derivatives).
     */
    SendPq = 'send-pq'
}
