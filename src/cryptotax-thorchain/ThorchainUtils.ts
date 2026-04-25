export function getDefaultRuneGas(): string {
    return '2000000';
}

export function formatBlockchainForOutput(blockchain: string): string {
    return blockchain === 'THOR' ? 'THORChain' : blockchain;
}
