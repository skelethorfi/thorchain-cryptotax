import {ViewblockEvent, ViewblockEventSend, ViewblockTx} from "../viewblock";
import {CryptoTaxTransaction, CryptoTaxTransactionType} from "../cryptotax";
import assert from "assert";
import {TypeMsgSends, ViewblockMsg, ViewblockTxV2} from "../viewblock";

// 0.02 RUNE
const DEFAULT_RUNE_GAS = '2000000';

export interface IThorchainMapper {
    toCtc(): CryptoTaxTransaction[];
}

export class BaseMapper implements IThorchainMapper {

    wallet: string;
    tx: ViewblockTx;
    timestamp: string;
    idPrefix: string;
    datetime: Date;

    constructor(tx: ViewblockTx, wallet: string) {
        this.wallet = wallet;

        this.tx = tx;

        this.datetime = new Date(tx.timestamp);
        this.timestamp = this.datetime.toISOString();
        this.idPrefix = this.datetime.toISOString();
    }

    getId(type: CryptoTaxTransactionType) {
        return `${this.idPrefix}.${type}`;
    }

    getEvent(name: string): ViewblockEvent {
        if (name !== 'send') {
            throw new Error('only send events are currently supported');
        }

        // outdated
        // const events = this.tx.extra.events.filter(event => event.name === name);

        // mapping new tx format to old format

        const msgs = this.tx.msgs.filter(msg => TypeMsgSends.includes(msg['@type']));
        assert.equal(msgs.length, 1);

        const msg: ViewblockMsg = msgs[0];
        const tx2: ViewblockTxV2 = (this.tx as any) as ViewblockTxV2;

        const event: ViewblockEventSend = {
            name: 'send',
            fee: {
                amount: [{
                    denom: tx2.gas?.asset ?? 'THOR.RUNE', // expecting sends only on THORChain
                    amount: tx2.gas?.amount ?? DEFAULT_RUNE_GAS
                }],
                gas: tx2.gas_used
            },
            params: {
                fromAddress: msg.from_address,
                toAddress: msg.to_address,
                poolAsset: tx2.input.asset,
                coins: [
                    {
                        asset: tx2.input.asset,
                        amount: msg.amount[0].amount,
                        decimals: '8'
                    }
                ]
            }
        };

        return event;
    }

    getEvents(name: string): ViewblockEvent[] {
        return this.tx.extra.events.filter(event => event.name === name);
    }

    toCtc(): CryptoTaxTransaction[] {
        throw Error('not implemented');
    }
}
