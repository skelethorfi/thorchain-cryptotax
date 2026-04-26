import {Viewblock} from "../viewblock";
import fs from "fs-extra";
import {format} from 'date-fns-tz';
import {CryptoTaxTransaction, writeCsv} from "../cryptotax";
import {MidgardService} from "../cryptotax-thorchain/MidgardService";
import {ThornodeService} from "../cryptotax-thorchain/ThornodeService";
import {TcyDistributionService} from "../cryptotax-thorchain/TcyDistributionService";
import {Action, ActionStatusEnum, ActionTypeEnum} from "@xchainjs/xchain-midgard";
import {ITaxConfig} from "./ITaxConfig";
import {Reporter} from "./Reporter";
import {IWallet} from "./IWallet";
import {TaxEvents} from "./TaxEvents";
import {DateRange, generateDateRanges} from "../utils/DateRange";
import path from "path";
import {BaseMapper} from "./BaseMapper";
import {getActionDate} from "../cryptotax-thorchain/MidgardActionMapper";
import {TaxConfig} from "./TaxConfig";
import {TcyDistributionMapper} from "../cryptotax-thorchain/TcyDistributionMapper";

export function shouldFetchThornodeTx(action: Action): boolean {
    return action.type === ActionTypeEnum.Switch || action.type === ActionTypeEnum.Swap;
}

export class Exporter {
    config: ITaxConfig;
    viewblock: Viewblock;
    midgard: MidgardService;
    thornode: ThornodeService;
    tcyDistribution: TcyDistributionService;
    report: Reporter;

    constructor(filename: string) {
        this.config = TaxConfig.load(filename);
        const cachePath = this.config.cachePath;
        this.viewblock = new Viewblock(path.join(cachePath, 'viewblock'));
        this.midgard = new MidgardService(path.join(cachePath, 'midgard'));
        this.thornode = new ThornodeService(path.join(cachePath, 'thornode'));
        this.tcyDistribution = new TcyDistributionService(path.join(cachePath, 'tcy'));
        this.report = new Reporter();
    }

    async getEvents(wallet: IWallet, outputPath: string): Promise<TaxEvents> {
        const events = new TaxEvents();

        const txs = await this.viewblock.getAllTxs({
            address: wallet.address,
            network: 'mainnet'
            // type: 'all',
        });

        for (const tx of txs) {
            try {
                events.addViewblock(tx, wallet, this.config);
            } catch (error) {
                // Log the error, save a copy of failed transaction and keep going
                console.error(error);
                const mapper = new BaseMapper(tx, wallet.address);
                this.saveFailure(outputPath, wallet.address, 'viewblock', mapper.datetime, tx, error);
            }
        }

        // Get Midgard actions
        let actions: Action[] = await this.midgard.getActions(wallet.address);

        actions = this.excludeNonSuccess(actions);

        for (const action of actions) {
            const thornodeTxs = [];

            if (shouldFetchThornodeTx(action)) {
                // For swaps and switches, use the inbound thornode transaction to determine the wallet-paid gas fee.
                const tx = await this.thornode.getTxStatus(action.in[0].txID);
                thornodeTxs.push(tx);
            }

            try {
                events.addMidgard(action, wallet, thornodeTxs, this.config);
            } catch (error) {
                // Log the error, save a copy of failed transaction and keep going
                console.error(error);
                this.saveFailure(outputPath, wallet.address, 'midgard', getActionDate(action), action, error);
            }
        }

        // Get TCY distributions
        if (this.isThorchain(wallet.address)) {
            const tcyDistribution = await this.tcyDistribution.getTcyDistribution(wallet.address);
            const distributions = tcyDistribution.distributions || [];

            for (const item of distributions) {
                try {
                    events.addTcyDistribution(item, wallet, this.config);
                } catch (error) {
                    // Log the error, save a copy of failed transaction and keep going
                    console.error(error);
                    this.saveFailure(outputPath, wallet.address, 'tcy', TcyDistributionMapper.parseDate(item), item, error);
                }
            }
        }

        return events;
    }

    excludeNonSuccess(actions: Action[]): Action[] {
        // loan repayments will show as 'pending' if the loan is not closed
        return actions.filter(
            (action: Action) => {
                return action.status === ActionStatusEnum.Success || (action.metadata.swap as any)?.txType === 'loanRepayment'
            }
        );
    }

    saveToCsv(txs: CryptoTaxTransaction[], outputPath: string) {
        let expectedExportCount =  0;
        let count = 0;
        const walletExchanges = this.getUniqueWalletExchanges(txs);

        // Output all fetched txs in a single CSV
        writeCsv(path.join(outputPath, 'all.csv'), txs);

        const ranges = generateDateRanges(this.config.fromDate, this.config.toDate, this.config.frequency);

        for (const range of ranges) {
            const rangeTxs = this.getTxsInRange(txs, range);
            expectedExportCount += rangeTxs.length;

            // Output all txs in each range to CSV
            const fn1 = `all-${range.from}_${range.to}.csv`;

            writeCsv(path.join(outputPath, fn1), rangeTxs);

            // If no txs in the current range then skip
            if (rangeTxs.length === 0) {
                continue;
            }

            for (const walletExchange of walletExchanges) {
                const walletTxs = this.getTxsForWallet(rangeTxs, walletExchange);

                if (walletTxs.length) {
                    if (walletExchange === 'thorchain') {
                        // validate txs
                        const badTxs = walletTxs.filter(tx => tx.from !== 'thorchain' && tx.to !== 'thorchain');
                        if (badTxs.length > 0) {
                            console.error(badTxs);
                            throw new Error('bad txs');
                        }

                        const fn2 = `${range.from}_${range.to}_THOR_thorchain_swaps.csv`;

                        writeCsv(path.join(outputPath, fn2), walletTxs);

                        count += walletTxs.length;

                    } else {
                        const fn3 = this.makeFilename(walletExchange, range) + '.csv';

                        writeCsv(path.join(outputPath, fn3), walletTxs);

                        count += walletTxs.length;
                    }
                }
            }
        }

        console.log(`Total exported: ${count}`);

        if (count !== expectedExportCount) {
            throw new Error(`failed to export all txs. expected ${expectedExportCount}`);
        }
    }

    private getTxsForWallet(monthTxs: CryptoTaxTransaction[], walletExchange: string) {
        return monthTxs.filter(tx => tx.walletExchange === walletExchange);
    }

    private getTxsInRange(txs: CryptoTaxTransaction[], range: DateRange) {
        return txs.filter((tx) => {
            const txDate = new Date((tx.timestamp as string).split(' ')[0].split('/').reverse().join('-'));

            if (isNaN((txDate as any))) {
                console.log(tx);
                throw new Error('invalid date');
            }

            return txDate >= new Date(range.from) && txDate <= new Date(range.to);
        });
    }

    private getUniqueWalletExchanges(txs: CryptoTaxTransaction[]): Set<string> {
        return new Set(txs.map((tx) => {
            if (!tx.walletExchange) {
                console.warn(`WARN: missing walletExchange`);
                console.log(tx);
                return 'MISSING-ADDRESS';
            }

            return tx.walletExchange;
        }));
    }

    private findWalletByAddress(address: string) {
        return this.config.wallets.find(wallet => wallet.address.toLowerCase() === address.toLowerCase());
    }

    private makeFilename(walletExchange: string, range: DateRange) {
        const wallet = this.findWalletByAddress(walletExchange);

        if (!wallet) {
            console.warn(`wallet not found in config: ${walletExchange}`);
            return `${range.from}_${range.to}_${walletExchange}`;
        }

        return `${range.from}_${range.to}_${wallet.blockchain}_${this.shortenAddress(wallet.address)}_${wallet.name}`;
    }

    // Returns last 5 characters of address
    private shortenAddress(address: string): string {
        return address.slice(-5);
    }

    private saveFailure(outputPath: string, walletAddress: string, source: string, date: Date, data: any, error: any): void {
        const failureDir = path.join(outputPath, 'failures', walletAddress, source);
        fs.ensureDirSync(failureDir);
        const timestamp = format(date, 'yyyy-MM-dd_HHmm_ssSSS');
        const errorMessage = error.message || 'unknown error';
        fs.writeJsonSync(path.join(failureDir, `${timestamp}.json`), { ERROR_MESSAGE: errorMessage, ...data }, { spaces: 4});
    }

    private isThorchain(wallet: string): boolean {
        return wallet.toLowerCase().startsWith('thor1');
    }
}
