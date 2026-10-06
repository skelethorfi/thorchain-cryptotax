export interface IWallet {
    name: string;
    address: string;
    blockchain: string;
    // No longer supported (CoinMarketCap reference prices were removed); a warning is shown if true
    addReferencePrices?: boolean;
}
