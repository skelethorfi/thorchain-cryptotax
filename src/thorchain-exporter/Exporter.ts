import {Viewblock} from "../viewblock";
import fs from "fs-extra";
import {CryptoTaxTransaction, CryptoTaxTransactionType, writeCsv} from "../cryptotax";
import {MidgardService} from "../cryptotax-thorchain/MidgardService";
import {ThornodeService} from "../cryptotax-thorchain/ThornodeService";
import {Action, ActionStatusEnum} from "@xchainjs/xchain-midgard";
import {ITaxConfig} from "./ITaxConfig";
import {Reporter} from "./Reporter";
import {IWallet} from "./IWallet";
import {TaxEvents} from "./TaxEvents";
import {DateRange, generateDateRanges} from "../utils/DateRange";

const info = console.info;

export class Exporter {
    config: ITaxConfig;
    viewblock: Viewblock;
    midgard: MidgardService;
    thornode: ThornodeService;
    report: Reporter;

    constructor(filename: string) {
        this.config = this.loadConfig(filename);
        this.viewblock = new Viewblock();
        this.midgard = new MidgardService();
        this.thornode = new ThornodeService();
        this.report = new Reporter();
    }

    loadConfig(filename: string): ITaxConfig {
        info(`Load config: ${filename}`);
        return JSON.parse(fs.readFileSync(filename).toString());
    }

    async getEvents(wallet: IWallet): Promise<TaxEvents> {
        const events = new TaxEvents();

        const txs = await this.viewblock.getAllTxs({
            address: wallet.address,
            network: 'mainnet'
            // type: 'all',
        });

        for (const tx of txs) {
            events.addViewblock(tx, wallet);
        }

        // Get Midgard actions
        let actions: Action[] = await this.midgard.getActions(wallet.address);

        actions = this.excludeNonSuccess(actions);

        for (const action of actions) {
            const thornodeTxs = [];

            // Get related noOp tx
            if (action.metadata.swap?.txType === 'noOp') {
                const noopTxId = action.in[0].txID;
                const tx = await this.thornode.getTxStatus(noopTxId);
                thornodeTxs.push(tx);
            }

            events.addMidgard(action, wallet, thornodeTxs);
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

        const totalTxs = txs.length;
        let count = 0;
        const walletExchanges = this.getAllWalletExchanges(txs);

        writeCsv(`${outputPath}/all.csv`, txs);

        const ranges = generateDateRanges(this.config.fromDate, this.config.toDate, this.config.frequency);

        for (const range of ranges) {
            const periodTxs = this.getTxsInRange(txs, range);
            console.log(`${range.from} to ${range.to}`);
            console.log(periodTxs.length);

            if (periodTxs.length === 0) {
                continue;
            }

            for (const walletExchange of walletExchanges) {
                console.log(walletExchange);
                const walletTxs = this.getTxsForWallet(periodTxs, walletExchange);

                if (walletTxs.length) {
                    console.log(`${range.from} to ${range.to}`);
                    console.log(walletTxs.length);

                    if (walletExchange === 'thorchain') {
                        // validate txs
                        const badTxs = walletTxs.filter(tx => tx.from !== 'thorchain' && tx.to !== 'thorchain');
                        if (badTxs.length > 0) {
                            console.error(badTxs);
                            throw new Error('bad txs');
                        }

                        writeCsv(
                            `${outputPath}/${range.from}_${range.to}_THOR_thorchain_swaps.csv`,
                            walletTxs
                        );

                        count += walletTxs.length;

                    } else {
                        writeCsv(
                            `${outputPath}/${this.makeFilename(walletExchange, range)}.csv`,
                            walletTxs
                        );

                        count += walletTxs.length;
                    }
                }
            }
        }

        console.log(`Total expected: ${totalTxs}`);
        console.log(`Total exported: ${count}`);

        if (count !== totalTxs) {
            throw new Error('failed to export all txs');
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

    private getTxsForMonth(txs: CryptoTaxTransaction[], year: string, month: string) {
        return txs.filter((tx) => {
            const dateParts = (tx.timestamp as string).split(' ')[0].split('/').reverse();
            return dateParts[0] === year && dateParts[1] === month;
        });
    }

    private getAllWalletExchanges(txs: CryptoTaxTransaction[]): string[] {
        const walletExchanges: any = {};

        txs.map((tx) => {
            if (!tx.walletExchange) {
                console.warn(tx);
            }

            walletExchanges[tx.walletExchange ?? ''] = true;
        });

        // if (walletExchanges['']) {
        //     throw new Error('IWallet/exchange not provided');
        // }

        return Object.keys(walletExchanges);
    }

    txIsSendOrReceive(tx: CryptoTaxTransaction): boolean {
        return [
            CryptoTaxTransactionType.Send,
            CryptoTaxTransactionType.Receive
        ].includes(tx.type);
    }

    getSends(txs: CryptoTaxTransaction[]): CryptoTaxTransaction[] {
        return txs.filter(tx => this.txIsSendOrReceive(tx));
    }

    getNotSends(txs: CryptoTaxTransaction[]): CryptoTaxTransaction[] {
        return txs.filter(tx => !this.txIsSendOrReceive(tx));
    }

    private findWalletByAddress(address: string) {
        return this.config.wallets.find(wallet => wallet.address.toLowerCase() === address.toLowerCase());
    }

    private makeFilename(walletExchange: string, range: DateRange) {
        const wallet = this.findWalletByAddress(walletExchange);

        if (!wallet) {
            console.warn(`wallet not found in config: ${walletExchange}`);
            return walletExchange;
        }

        return `${range.from}_${range.to}_${wallet.blockchain}_${this.shortenAddress(wallet.address)}_${wallet.name}`;
    }

    private shortenAddress(address: string): string {
        return address.slice(-5);
    }
}
