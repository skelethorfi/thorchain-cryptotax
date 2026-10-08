// OAuth for Summ's MCP server: authorisation code with PKCE, dynamic client
// registration, refresh tokens. The token is kept in <state dir>/.auth.json
// (mode 600); the state dir is the user's private folder, never a repo.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'

export const ISSUER = 'https://mcp.summ.com'
export const MCP_URL = `${ISSUER}/mcp`
export const READ_SCOPE = 'mcp:read'
export const WRITE_SCOPE = 'mcp:read mcp:write'

interface Auth {
    client_id: string
    scope: string
    access_token: string
    refresh_token?: string
    expires_at: number
}

interface TokenResponse {
    access_token: string
    refresh_token?: string
    expires_in?: number
    scope?: string
}

const b64url = (buf: Buffer) => buf.toString('base64url')
const authFile = (stateDir: string) => join(stateDir, '.auth.json')

function loadAuth(stateDir: string): Auth {
    if (!existsSync(authFile(stateDir))) throw new Error(`Not logged in. Run: summ-sync login ${stateDir}`)
    return JSON.parse(readFileSync(authFile(stateDir), 'utf8'))
}

function saveAuth(stateDir: string, auth: Auth) {
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(authFile(stateDir), JSON.stringify(auth, null, 2), { mode: 0o600 })
    chmodSync(authFile(stateDir), 0o600)
}

async function postForm(url: string, params: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(params),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${url} -> ${res.status} ${text.slice(0, 300)}`)
    return JSON.parse(text)
}

function withExpiry(auth: Pick<Auth, 'client_id' | 'scope' | 'refresh_token'>, token: TokenResponse): Auth {
    return {
        ...auth,
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? auth.refresh_token,
        expires_at: Date.now() + (token.expires_in ?? 3600) * 1000,
    }
}

/** Authorise in the browser and save the token. `scope` is READ_SCOPE or WRITE_SCOPE. */
export async function login(stateDir: string, scope = READ_SCOPE): Promise<void> {
    const server = createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`

    const reg = await fetch(`${ISSUER}/oauth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_name: `summ-sync (${scope})`,
            redirect_uris: [redirectUri],
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            token_endpoint_auth_method: 'none',
            scope,
        }),
    })
    if (!reg.ok) throw new Error(`register -> ${reg.status} ${(await reg.text()).slice(0, 300)}`)
    const client = (await reg.json()) as { client_id: string }

    const verifier = b64url(randomBytes(32))
    const state = b64url(randomBytes(16))
    const authUrl = new URL(`${ISSUER}/oauth/authorize`)
    authUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: client.client_id,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: b64url(createHash('sha256').update(verifier).digest()),
        code_challenge_method: 'S256',
        resource: MCP_URL,
    }).toString()

    console.log(`Opening the browser to authorise (scope ${scope}). If it does not open, visit:\n${authUrl}\n`)
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [authUrl.toString()], () => {})

    const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for authorisation (5 min)')), 300_000)
        server.on('request', (req, res) => {
            const url = new URL(req.url ?? '/', redirectUri)
            if (url.pathname !== '/callback') return res.writeHead(404).end()
            const code = url.searchParams.get('state') === state ? url.searchParams.get('code') : null
            res.writeHead(code ? 200 : 400, { 'content-type': 'text/plain' })
            res.end(code ? 'Authorised. You can close this tab.' : `Failed: ${url.searchParams.get('error') ?? 'bad state'}`)
            clearTimeout(timer)
            if (code) resolve(code)
            else reject(new Error(`Authorisation failed: ${url.search}`))
        })
    })
    server.close()

    const token = await postForm(`${ISSUER}/oauth/token`, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: client.client_id,
        code_verifier: verifier,
        resource: MCP_URL,
    })
    saveAuth(stateDir, withExpiry({ client_id: client.client_id, scope: token.scope ?? scope }, token))
    console.log(`Logged in. Granted scope: ${token.scope ?? '(not reported)'}. Token saved to ${authFile(stateDir)}`)
}

/** A valid access token, refreshed when it is about to expire. */
export async function accessToken(stateDir: string): Promise<string> {
    let auth = loadAuth(stateDir)
    if (Date.now() < auth.expires_at - 60_000) return auth.access_token
    if (!auth.refresh_token) throw new Error('Token expired and there is no refresh token. Run login again.')
    const token = await postForm(`${ISSUER}/oauth/token`, {
        grant_type: 'refresh_token',
        refresh_token: auth.refresh_token,
        client_id: auth.client_id,
        resource: MCP_URL,
    })
    auth = withExpiry(auth, token)
    saveAuth(stateDir, auth)
    return auth.access_token
}
