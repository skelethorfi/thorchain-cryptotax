# thorchain-cryptotax

## What is this?

This is a tool to help with doing taxes for your THORChain transactions by exporting them
into a CSV format that can be directly imported into [Crypto Tax Calculator](https://cryptotaxcalculator.io/?via=glaj5hf5).

It has been built for myself to reduce the manual effort in doing taxes.
I'm sharing it in the hope that it makes it easier for others as well.

Having used Crypto Tax Calculator for years, I can highly recommend it.

You can get $40 off a subscription with this [referral link](https://cryptotaxcalculator.io/?via=glaj5hf5) (only applies if purchasing a plan for the first time).

Currently supported transactions

- sends/receives of Rune
- sends/receives of Synth Assets
- upgrade BEP Rune to native Rune
- swaps
- LPs (add/remove liquidity)
- lending
- savers
- bonding/unbonding
- TCY claiming (Note: This is mapped as a Receive/Transfer In)
- TCY staking/unstaking
- TCY distributions (i.e. RUNE received from staking TCY)
- RUNEPool deposit/withdrawal
- Thorname register/update
- rujira-merge/deposit

Not currently supported

- Rujira contracts
- Maya Protocol
- aggregated swaps (i.e. where the swap is routed through more than just THORChain)

## Usage

There are 2 ways to run this tool.
1. Run using NodeJS
2. Run using Replit

### Run using NodeJS
If you are familiar with Git and NodeJS.<br>
Follow the [NodeJS Instructions](docs/nodejs-instructions.md).

### Run using Replit
Allows you to run in the browser.<br>
Follow the [Replit Instructions](docs/replit-instructions.md).

### Import into Crypto Tax Calculator

Once you have successfully exported transactions into CSV files, you can import them
into Crypto Tax Calculator.

Log in to Crypto Tax Calculator

Go to **Integrations**

Click **Add integrations**

Search for **THORChain** and click it

Click **Upload** to select the files

You only need to import your THORChain wallet CSV files (YYYY-MM-DD_YYYY-MM-DD_**THOR**_xxxxx_Sample.csv).<br>
Not the CSV files for other wallets (as they are added into Crypto Tax Calculator using their own wallet integrations).

Once you've selected all the files then click **Import THORChain CSV**

This will import all the transactions that use your THORChain wallets. This will include
sends/receives, and swaps, LPs, savers, lending.

### Categorising Transactions

As THORChain is a cross-chain protocol, most transactions span more than one blockchain.

This means the transactions from your THORChain wallet may only be one side of the action.
For example, a transaction could be adding RUNE to an LP and there could be another transaction of adding BTC
to the same LP. Or you may have a swap from BTC to ETH which won't even appear as
any transaction in your THORChain wallet (it will be in the other wallet CSV files and in **all.csv**).

Crypto Tax Calculator has support for these other chains, like BTC, ETH, etc.
You need to add the wallet addresses in the integrations section of CTC and once they
are imported, you will need to categorise the transactions from the other chains.

To help you categorise the transactions, you can refer to the **all.csv** file or
the other individual wallet files to be able to see a description on the transaction
which can look something like "1/2 - Swap 1 BTC to 20 ETH; tx12345".

Swaps should be updated in CTC as **Cross Chain Sell** (outgoing from your wallet to THORChain) and **Cross Chain Buy** (incoming into your wallet from THORChain).<br>
They will be listed in the CSV files as `bridge-trade-out` and `bridge-trade-in`.

The same needs to be done for categorising transactions on the other chains.
Such as **Add Liquidity**, **Remove Liquidity**, etc.

### Missing Market Prices

The other manual step that needs to be performed in CTC is to add missing market
prices.

If you have a swap of say RUNE to VTHOR, it won't have the market price for VTHOR.
But it does have the market price for RUNE. So you can copy the fiat amount from the RUNE
side (Cross Chain Sell) and apply it to the VTHOR side (Cross Chain Buy).

The other instance where there won't be market prices is for adding/removing liquidity
via LPs or savers.

Add to an LP with dual assets will be listed as 4 transactions in CTC.

- Add Liquidity (Asset 1)
- Add Liquidity (Asset 2)
- Receive Receipt Token (aka. Receive LP Token)
- Spam

The reason for the Spam transaction is to help you get the market price.
If its a dual LP add then the Spam transaction will be 2x the RUNE amount.
If its an asymmetric add then the Spam transaction will be a copy of the single asset
being added.

Copy the fiat value from the Spam transaction, and apply it into the **Receive Receipt Token**
transaction. If it is withdrawing from an LP then apply it to the **Return Receipt Token** transaction.

## Reporting Issues / Supporting Development

If you run into errors (probably likely as I mainly built this to cover my own usage),
you can either raise them in GitHub https://github.com/skelethorfi/thorchain-cryptotax/issues or
DM me on Twitter/X [@skelethorfi](https://x.com/skelethorfi).

If you found this useful, and it saved you a lot of manual effort, feel free to send a small donation as thanks:
- BTC: `bc1qe3lhk5d72gs6t7q6z5z982dfhzfya7d8t9thha`
- ETH: `0x6822b44Fe0EDa7962E59ed11bfdFa1F323F19C0a`
- THORChain: `thor1q3dsqslgz3kdxprvcra3e2xmessznlz0d7n3pf`

## Other Notes

### Liquidity Pools

- LP actions are converted to Add/Remove Liquidity transactions for Crypto Tax Calculator
- It also creates Receive/Return LP Token transactions
  - LP Token amount is set to the `liquidityUnits` amount provided by Midgard
  - LP token is given the name `ThorLP.{asset}`
    - e.g. ThorLP.BTC.BTC

### Savers

- Savers are converted to Add/Remove Liquidity transactions for Crypto Tax Calculator
  - **Note:** In THORChain when doing a Savers deposit, it goes into the liquidity pool
    and the other side of the LP is provided by the protocol.
    Assumption here is that Savers should be considered as LP rather than staking when
    converting to Crypto Tax Calculator.
- It also creates Receive/Return LP Token transactions
  - LP Token amount is set to the `liquidityUnits` amount provided by Midgard
    - For Savers, this is equal to the asset amount being added
  - LP token is given the name `ThorLP.{savers_asset}`
    - e.g. ThorLP.BTC/BTC (savers assets have a slash)

### Sends/Receives

Sends and receives are fetched using the viewblock.io API.
This is not a public API, so may change without warning which breaks the tool.

### Reference Prices

Fetching reference prices is disabled as it's not currently working and needs updating.

So adding the market price to LP transactions requires the manual step of copying the fiat amount from
the related Spam transaction into the market value section for the LP token in CTC.

### Useful References

- [Crypto Tax Calculator - Advanced CSV Import](https://help.cryptotaxcalculator.io/en/articles/5777675-advanced-custom-csv-import)
- [THORChain Dev Docs - Asset Notation](https://dev.thorchain.org/concepts/asset-notation.html)
- [THORChain Dev Docs - Transaction Memos](https://dev.thorchain.org/concepts/memos.html)
- [Thornode API docs](https://gateway.liquify.com/chain/thorchain_api/thorchain/doc)
- [XChainJS docs](https://docs.xchainjs.org)
