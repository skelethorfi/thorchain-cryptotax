import {type Action, ActionStatusEnum, ActionTypeEnum} from "@xchainjs/xchain-midgard";
import {assetFromStringEx, AssetType} from "@xchainjs/xchain-util";
import {MidgardService} from "./thorchain/MidgardService.ts";
import {ThornodeService} from "./thorchain/ThornodeService.ts";
import {CosmosTxService, getCosmosTxIds} from "./thorchain/CosmosTxService.ts";
import {MayanodeService} from "./maya/MayanodeService.ts";
import {TcyDistributionService} from "./tcy/TcyDistributionService.ts";
import type {MayaFundService} from "./maya/MayaFundService.ts";
import {MAYA} from "../domain/Protocol.ts";
import {getActionDate} from "./thorchain/MidgardUtils.ts";
import {Viewblock} from "./viewblock/index.ts";
import {type Protocol, THORCHAIN} from "../domain/Protocol.ts";
import {getBundleKey, type RawBundle} from "./RawBundle.ts";
import type {NotFinal} from "./Pending.ts";

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
// notFinal: collects every action whose status is not 'success', exported or not, for the run summary.
// stuckBefore: an action still pending from before this date is stuck (docs/specs/pending.md)
export class MidgardSource implements Source {
    private protocol: Protocol;
    private midgard: MidgardService;
    private thornode: ThornodeService;
    private cosmosTxs: CosmosTxService;
    private notFinal: NotFinal[];
    private stuckBefore?: Date;
    private mayanode?: MayanodeService;
    constructor(protocol: Protocol, midgard: MidgardService, thornode: ThornodeService,
                cosmosTxs: CosmosTxService, notFinal: NotFinal[] = [], stuckBefore?: Date,
                mayanode?: MayanodeService) {
        this.protocol = protocol;
        this.midgard = midgard;
        this.thornode = thornode;
        this.cosmosTxs = cosmosTxs;
        this.notFinal = notFinal;
        this.stuckBefore = stuckBefore;
        this.mayanode = mayanode;
    }

    async bundlesFor(wallet: string): Promise<RawBundle[]> {
        const actions = await this.midgard.getActions(wallet);
        const keyOf = (action: Action) => getBundleKey({source: 'midgard', protocol: this.protocol.id, wallet, data: action, thornodeTxs: [], cosmosTxs: []});
        // Successful actions by inbound txid; a send is left out, as it is how the wallet paid, not what it got
        const settled = new Map(actions
            .filter(action => action.status === ActionStatusEnum.Success && action.type !== ActionTypeEnum.Send && action.in[0]?.txID)
            .map(action => [action.in[0].txID, keyOf(action)]));
        const bundles: RawBundle[] = [];

        for (const action of actions) {
            let included = shouldIncludeAction(action);

            if (action.status !== ActionStatusEnum.Success) {
                const coveredBy = settled.get(action.in[0]?.txID ?? '');
                included ||= !coveredBy && this.isStuckRefund(action);
                this.notFinal.push({key: keyOf(action), action, exported: included, ...(coveredBy ? {coveredBy} : {})});
            }

            if (included) {
                bundles.push(await this.bundle(action, wallet));
            }
        }

        return bundles;
    }

    // A refund still pending past the cut-off will not be paid out: it is exported, and what was not returned is
    // lost (docs/specs/pending.md)
    private isStuckRefund(action: Action): boolean {
        return action.type === ActionTypeEnum.Refund && !!this.stuckBefore && getActionDate(action) < this.stuckBefore;
    }

    // The bundle of one action; the fixture tool uses this for an action it looked up by txid
    async bundle(action: Action, wallet: string): Promise<RawBundle> {
        const isThorchain = this.protocol.id === THORCHAIN.id;
        const thornodeTxs = [];
        const cosmosTxs = [];

        for (const txId of isThorchain ? getThornodeTxIds(action) : []) {
            thornodeTxs.push(await this.thornode.getTxStatus(txId, getActionDate(action), Number(action.height)));
        }

        for (const txId of isThorchain ? getCosmosTxIds(action) : []) {
            cosmosTxs.push(await this.cosmosTxs.getTx(txId, getActionDate(action)));
        }

        // Maya's native fee has changed over time: the setting at the action's height (docs/specs/maya.md, Fees)
        const nativeFee = this.mayanode ? (await this.mayanode.nativeFee(Number(action.height), getActionDate(action))).amount : undefined;

        return {source: 'midgard', protocol: this.protocol.id, wallet, data: action, thornodeTxs, cosmosTxs, ...(nativeFee ? {nativeFee} : {})};
    }
}

// Viewblock's txs of a THORChain wallet, for the sends Midgard does not list (docs/specs/sends.md);
// selectSends keeps those
export class ViewblockSource implements Source {
    private viewblock: Viewblock;
    constructor(viewblock: Viewblock) {
        this.viewblock = viewblock;
    }

    async bundlesFor(wallet: string): Promise<RawBundle[]> {
        if (!wallet.toLowerCase().startsWith('thor1')) {
            return [];
        }

        const txs = await this.viewblock.getTxs(wallet);
        return txs.map(tx => ({source: 'viewblock', protocol: THORCHAIN.id, wallet, data: tx, thornodeTxs: [], cosmosTxs: []}));
    }
}

// TCY distributions, for THORChain wallets only
export class TcySource implements Source {
    private tcyDistribution: TcyDistributionService;
    constructor(tcyDistribution: TcyDistributionService) {
        this.tcyDistribution = tcyDistribution;
    }

    async bundlesFor(wallet: string): Promise<RawBundle[]> {
        if (!wallet.toLowerCase().startsWith('thor1')) {
            return [];
        }

        const {distributions} = await this.tcyDistribution.getTcyDistribution(wallet);
        return (distributions || []).map(item => ({source: 'tcy', protocol: THORCHAIN.id, wallet, data: item, thornodeTxs: [], cosmosTxs: []}));
    }
}

// Maya fund payouts, for Maya wallets that have received MAYA: from the first payout after the first receipt
// (docs/specs/maya.md, Maya fund)
export class MayaFundSource implements Source {
    private midgard: MidgardService;
    private fund: MayaFundService;
    constructor(midgard: MidgardService, fund: MayaFundService) {
        this.midgard = midgard;
        this.fund = fund;
    }

    async bundlesFor(wallet: string): Promise<RawBundle[]> {
        if (!wallet.toLowerCase().startsWith(MAYA.nativeAddressPrefix)) {
            return [];
        }

        const actions = await this.midgard.getActions(wallet);
        const receipts = actions.filter(action => action.out.some(out => out.address === wallet && out.coins.some(coin => coin.asset === 'MAYA')));

        if (receipts.length === 0) {
            return [];
        }

        const firstHeight = Math.min(...receipts.map(action => Number(action.height)));
        // An action can pay the wallet out in a later block than its own (e.g. a streaming swap)
        const actionHeights = new Set(actions.flatMap(action => [action.height, ...action.out.map(out => out.height)])
            .filter((height): height is string => !!height).map(Number));
        const payouts = await this.fund.getPayouts(wallet, firstHeight, actionHeights);
        return payouts.map(payout => ({source: 'maya-fund', protocol: MAYA.id, wallet, data: payout, thornodeTxs: [], cosmosTxs: []}));
    }
}
