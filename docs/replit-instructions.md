# Run using Replit

## Prerequisites

- Replit account<br>
  If you don't already have one, go to https://replit.com and sign up

## Steps

### 1. Fork the Repl

Forking the Repl into your own account allows you to run it.

Go to https://replit.com/@skelethorfi/thorchain-cryptotax

Click **Fork**

Select **Public**

Click **Fork Repl**

### 2. Configure your wallets

Click on the **wallets-config.toml** file in the workspace

Add your wallet addresses, they can be given names using the `name` property.
Which is helpful to identify the wallets when looking at the generated CSV filenames.

Set `fromDate`, `toDate`, and `frequency` ("monthly", "yearly", "none") for how to split up the CSV files.
Set `timezone` (e.g. "Australia/Melbourne") so the periods follow your tax year in local time; the default is UTC ([periods](specs/periods.md)).

The `blockchain` property for each wallet is only used in creating the CSV filenames, so it can be anything.
e.g. "THOR", "BTC", "ETH"

### 3. Run the export

Click **Run**

This will get all the transactions for the wallets and create CSV files in the following path:

- `./output/{current_datetime}/csv`

### 4. Download the CSV files

Click on the **output** folder

Then the **date/time** folder

Then the **csv** folder

This contains the exported CSV files

Hover over a file and click on the 3 dots and select **Download**

Download each of the "THOR" files (those for your THORChain wallets) as well as the
**all.csv** file (this contains transactions across all wallets).

The **all.csv** file can be used as a reference to categorise transactions for the non-THORChain wallets.

Refer to the [README](../README.md) for importing into Crypto Tax Calculator
