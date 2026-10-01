import {ViewblockTx} from "../viewblock";
import {Action} from "@xchainjs/xchain-midgard";
import {CryptoTaxTransaction} from "../cryptotax";
import {IThorchainMapper} from "./BaseMapper";
import {SendMapper} from "./SendMapper";
import {IWallet} from "./IWallet";
import {ITaxConfig} from "./ITaxConfig";
import {actionToCryptoTax} from "../cryptotax-thorchain/MidgardActionMapper";
import {TxStatusResponse} from "@xchainjs/xchain-thornode";
import {DelegateArkeoMapper} from "./DelegateArkeoMapper";
import {TcyDistributionItem} from "../cryptotax-thorchain/TcyDistributionService";
import {TcyDistributionMapper} from "../cryptotax-thorchain/TcyDistributionMapper";
import {Protocol, THORCHAIN} from "../protocols/Protocol";

type TaxEventSource = 'viewblock' | 'midgard' | 'tcy';

export class TaxEvent {

    datetime: Date;
    source: TaxEventSource;
    input?: ViewblockTx | Action | TcyDistributionItem;
    thornodeTxs: TxStatusResponse[] = [];  // Related txs from THORNode API
    output: CryptoTaxTransaction[] = [];
    wallet: IWallet;
    addReferencePrices: boolean;
    config: ITaxConfig;
    // Protocol of a midgard event
    protocol: Protocol;

    constructor(datetime: Date, source: TaxEventSource, wallet: IWallet, config: ITaxConfig, protocol: Protocol = THORCHAIN) {
        this.datetime = datetime;
        this.source = source;
        this.wallet = wallet;
        this.addReferencePrices = wallet.addReferencePrices ?? false;
        this.config = config;
        this.protocol = protocol;
    }

    convert() {
        if (this.source === 'viewblock') {
            this.convertViewblock(this.addReferencePrices);
        } else if (this.source === 'midgard') {
            this.convertMidgardAction(this.addReferencePrices);
        } else if (this.source === 'tcy') {
            this.convertTcy();
        }
    }

    convertViewblock(addReferencePrices: boolean) {
        const tx = this.input as ViewblockTx;

        // const labels = tx.extra.thorLabels;
        const labels = tx.types;

        let mapper: IThorchainMapper | undefined;

        if (labels.includes('send')) {
            // Check if memo starts with "delegate:arkeo:"
            const memo = tx.memo || '';
            const isDelegateArkeo = memo.startsWith('delegate:arkeo:');

            if (isDelegateArkeo) {
                mapper = new DelegateArkeoMapper(tx, this.wallet.address);
            } else {
                mapper = new SendMapper(tx, this.wallet.address);
            }
        }

        if (!mapper) {
            // Commented out warning as I'm currently only getting 'sends' from viewblock.
            // Getting other actions from Midgard

            // warn('####### missing mapper #######');
            // info(labels);
            return [];
        }

        this.output = mapper.toCtc();
    }

    convertMidgardAction(addReferencePrices: boolean) {
        this.output = actionToCryptoTax(this.input as Action, this.thornodeTxs, addReferencePrices, this.config.unsupportedActionsPath, this.protocol);
    }

    convertTcy() {
        const mapper = new TcyDistributionMapper(this.input as TcyDistributionItem, this.wallet.address);
        this.output = mapper.toCtc();
    }
}
