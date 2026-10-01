// The previous defaults (midgard/thornode.thorchain.network and *.ninerealms.com) no longer
// resolve in DNS (checked 2026-10-01).
export const API_URLS = {
    thornode: process.env.THORNODE_API_URL || 'https://gateway.liquify.com/chain/thorchain_api',
    thornodeArchive: process.env.THORNODE_API_ARCHIVE_URL || 'https://gateway.liquify.com/chain/thorchain_api',
    midgard: process.env.MIDGARD_API_URL || 'https://gateway.liquify.com/chain/thorchain_midgard',
};
