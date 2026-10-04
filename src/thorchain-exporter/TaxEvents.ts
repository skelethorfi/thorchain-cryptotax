import {TaxEvent} from "./TaxEvent";
import {CryptoTaxTransaction} from "../cryptotax";

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
}
