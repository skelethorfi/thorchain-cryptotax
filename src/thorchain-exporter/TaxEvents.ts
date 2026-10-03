import {TaxEvent} from "./TaxEvent";
import {ViewblockTx} from "../viewblock";
import {BaseMapper} from "./BaseMapper";
import {IWallet} from "./IWallet";
import {ITaxConfig} from "./ITaxConfig";
import {CryptoTaxTransaction} from "../cryptotax";
import {Action} from "@xchainjs/xchain-midgard";
import {getActionDate} from "../cryptotax-thorchain/MidgardActionMapper";
import {deepEqual} from "../utils/DeepEqual";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {TcyDistributionItem} from "../cryptotax-thorchain/TcyDistributionService";
import {TcyDistributionMapper} from "../cryptotax-thorchain/TcyDistributionMapper";
import {Protocol, THORCHAIN} from "../protocols/Protocol";
import {CosmosTx} from "../cryptotax-thorchain/CosmosTxService";

export class TaxEvents {

    events: TaxEvent[] = [];

    addViewblock(tx: ViewblockTx, wallet: IWallet, config: ITaxConfig) {
        const mapper = new BaseMapper(tx, wallet.address);
        const event = new TaxEvent(mapper.datetime, 'viewblock', wallet, config);
        event.input = tx;
        event.convert();

        // TODO: consolidate events? ie. input from both viewblock and midgard
        this.events.push(event);
    }

    addMidgard(action: Action, wallet: IWallet, thornodeTxs: TxStatusResponse[] = [], config: ITaxConfig, protocol: Protocol = THORCHAIN,
               cosmosTxs: CosmosTx[] = []) {
        const event = new TaxEvent(getActionDate(action), 'midgard', wallet, config, protocol);
        event.input = action;
        event.thornodeTxs = thornodeTxs;
        event.cosmosTxs = cosmosTxs;
        event.convert();

        this.events.push(event);
    }

    addTcyDistribution(item: TcyDistributionItem, wallet: IWallet, config: ITaxConfig) {
        const datetime = TcyDistributionMapper.parseDate(item);
        const event = new TaxEvent(datetime, 'tcy', wallet, config);
        event.input = item;
        event.convert();

        this.events.push(event);
    }

    sortDesc() {
        this.events.sort((a, b) => b.datetime.getTime() - a.datetime.getTime());
    }

    getAllCtcTx(): CryptoTaxTransaction[] {
        return this.events.flatMap(event => event.output);
    }

    filterByWallet(wallet: IWallet): TaxEvent[] {
        return this.events.filter(event => event.wallet.address === wallet.address);
    }

    isDuplicate(newEvent: TaxEvent): boolean {
        let isDuplicate = false;

        if (newEvent.source !== 'midgard') {
            return false;
        }

        const action = newEvent.input as Action;

        this.events.forEach((event) => {
            if (event.source === 'midgard' && (event.input as Action).date === action.date) {
                if (deepEqual(action, event.input as Action)) {
                    console.log(
                        'Excluding duplicate action: ' + JSON.stringify(action)
                    );

                    isDuplicate = true;
                }
            }
        });

        return isDuplicate;
    }

    addEvents(newEvents: TaxEvents) {
        const nonDuplicates = newEvents.events.filter(event => !this.isDuplicate(event));
        this.events.push(...nonDuplicates);
    }
}
