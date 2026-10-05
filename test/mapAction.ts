import {CryptoTaxTransaction} from '../src/cryptotax';
import {runBundle} from '../src/pipeline/run';
import {Protocol, THORCHAIN} from '../src/protocols/Protocol';

// A Midgard action through the exporter's path: interpreted, then exported as rows. A failure throws.
export function mapAction(action: any, thornodeTxs: any[] = [], protocol: Protocol = THORCHAIN): CryptoTaxTransaction[] {
    const bundle = {source: 'midgard' as const, protocol: protocol.id, wallet: '', data: action, thornodeTxs, cosmosTxs: []};
    const {rows, issues} = runBundle(bundle, protocol);
    const failure = issues.find(issue => issue.kind === 'failed');

    if (failure) {
        throw new Error(failure.message);
    }

    return rows;
}
