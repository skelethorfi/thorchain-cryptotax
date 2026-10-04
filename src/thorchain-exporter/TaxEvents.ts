import {TaxEvent} from "./TaxEvent";
import {IWallet} from "./IWallet";
import {CryptoTaxTransaction} from "../cryptotax";
import {Action} from "@xchainjs/xchain-midgard";
import {deepEqual} from "../utils/DeepEqual";

export class TaxEvents {

    events: TaxEvent[] = [];

    add(event: TaxEvent) {
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
