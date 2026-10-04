import {Action, ActionStatusEnum, ActionTypeEnum} from "@xchainjs/xchain-midgard";
import {assetFromStringEx, AssetType} from "@xchainjs/xchain-util";
import {MidgardService} from "../cryptotax-thorchain/MidgardService";
import {ThornodeService} from "../cryptotax-thorchain/ThornodeService";
import {CosmosTxService, getCosmosTxIds} from "../cryptotax-thorchain/CosmosTxService";
import {TcyDistributionService} from "../cryptotax-thorchain/TcyDistributionService";
import {getActionDate} from "../cryptotax-thorchain/MidgardActionMapper";
import {Viewblock} from "../viewblock";
import {Protocol, THORCHAIN} from "../protocols/Protocol";
import {RawBundle} from "./RawBundle";

// Lists the raw bundles of one wallet from one API
export interface Source {
    bundlesFor(wallet: string): Promise<RawBundle[]>;
}

// The inbound txids to look up on THORNode, which is the only source of the gas the wallet paid on an
// L1 chain (docs/specs/fees.md). A refund's is looked up to see what the wallet sent, not for its gas.
export function getThornodeTxIds(action: Action): string[] {
    const inbounds = action.in ?? [];
    let txIds: (string | undefined)[] = [];

    if (action.type === ActionTypeEnum.Swap || action.type === ActionTypeEnum.Switch || action.type === ActionTypeEnum.Refund) {
        txIds = [inbounds[0]?.txID];
    } else if (action.type === ActionTypeEnum.AddLiquidity || action.type === ActionTypeEnum.Withdraw) {
        // Deposits and withdrawal requests sent on THORChain pay the native fee, so only L1 ones are looked up
        txIds = inbounds.filter(inbound => isL1Asset(inbound.coins[0]?.asset)).map(inbound => inbound.txID);
    }

    // Old Midgard reports LP positions from before its start with the placeholder txid 'genesisTx'
    return [...new Set(txIds.filter((txId): txId is string => !!txId && txId !== 'genesisTx'))];
}

function isL1Asset(asset?: string): boolean {
    if (!asset) {
        return false;
    }

    const {chain, type} = assetFromStringEx(asset);

    return chain !== 'THOR' && type === AssetType.NATIVE;
}

export function shouldIncludeAction(action: Action): boolean {
    if (action.status === ActionStatusEnum.Success) {
        return true;
    }

    const txType = (action.metadata.swap as any)?.txType;

    // Loan repayments show as 'pending' if the loan is not closed
    if (txType === 'loanRepayment') {
        return true;
    }

    // A loan open with an output was paid out, whatever its status. Midgard reports loan opens that
    // borrowed RUNE as 'pending' (the RUNE payout has no txid). See docs/specs/loans.md.
    if (txType === 'loanOpen') {
        return action.out.some(out => out.coins.length > 0);
    }

    return false;
}

// Midgard actions of one protocol. Only THORChain actions get their THORNode and Cosmos txs.
export class MidgardSource implements Source {
    constructor(private protocol: Protocol, private midgard: MidgardService, private thornode: ThornodeService,
                private cosmosTxs: CosmosTxService) {
    }

    async bundlesFor(wallet: string): Promise<RawBundle[]> {
        const actions = (await this.midgard.getActions(wallet)).filter(shouldIncludeAction);
        const bundles: RawBundle[] = [];

        for (const action of actions) {
            bundles.push(await this.bundle(action, wallet));
        }

        return bundles;
    }

    // The bundle of one action; the fixture tool uses this for an action it looked up by txid
    async bundle(action: Action, wallet: string): Promise<RawBundle> {
        const isThorchain = this.protocol.id === THORCHAIN.id;
        const thornodeTxs = [];
        const cosmosTxs = [];

        for (const txId of isThorchain ? getThornodeTxIds(action) : []) {
            thornodeTxs.push(await this.thornode.getTxStatus(txId, getActionDate(action)));
        }

        for (const txId of isThorchain ? getCosmosTxIds(action) : []) {
            cosmosTxs.push(await this.cosmosTxs.getTx(txId, getActionDate(action)));
        }

        return {source: 'midgard', protocol: this.protocol.id, wallet, data: action, thornodeTxs, cosmosTxs};
    }
}

// THORChain sends (Viewblock), until row 6 replaces them with Midgard sends
export class ViewblockSource implements Source {
    constructor(private viewblock: Viewblock) {
    }

    async bundlesFor(wallet: string): Promise<RawBundle[]> {
        const txs = await this.viewblock.getAllTxs({address: wallet, network: 'mainnet'});
        return txs.map(tx => ({source: 'viewblock', protocol: THORCHAIN.id, wallet, data: tx, thornodeTxs: [], cosmosTxs: []}));
    }
}

// TCY distributions, for THORChain wallets only
export class TcySource implements Source {
    constructor(private tcyDistribution: TcyDistributionService) {
    }

    async bundlesFor(wallet: string): Promise<RawBundle[]> {
        if (!wallet.toLowerCase().startsWith('thor1')) {
            return [];
        }

        const {distributions} = await this.tcyDistribution.getTcyDistribution(wallet);
        return (distributions || []).map(item => ({source: 'tcy', protocol: THORCHAIN.id, wallet, data: item, thornodeTxs: [], cosmosTxs: []}));
    }
}
