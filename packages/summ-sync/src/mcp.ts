// Minimal MCP client over streamable HTTP: one JSON-RPC request per POST.
// Each client is created with the tools it may call; any other is refused.

import { MCP_URL, accessToken } from './auth.ts'

export const READ_TOOLS = ['query_summ_transactions', 'inspect_transaction', 'get_filter_options']

const DELAY_MS = 400 // a human-level request rate
const CONTEXT = "The user is syncing the client's transactions with a local export."

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface RpcMessage {
    id?: number
    result?: unknown
    error?: unknown
}

interface ToolResult {
    content?: { type: string; text?: string }[]
    isError?: boolean
}

export interface Tool {
    name: string
    annotations?: { readOnlyHint?: boolean }
}

export class McpClient {
    private readonly stateDir: string
    private readonly allowed: Set<string>
    private sessionId: string | undefined
    private nextId = 1

    constructor(stateDir: string, allowedTools: string[] = READ_TOOLS) {
        this.stateDir = stateDir
        this.allowed = new Set(allowedTools)
    }

    async rpc(method: string, params: unknown, { notify = false } = {}): Promise<unknown> {
        const headers: Record<string, string> = {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            authorization: `Bearer ${await accessToken(this.stateDir)}`,
        }
        if (this.sessionId) headers['mcp-session-id'] = this.sessionId
        const id = notify ? undefined : this.nextId++
        const res = await fetch(MCP_URL, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })
        this.sessionId = res.headers.get('mcp-session-id') ?? this.sessionId
        const text = await res.text()
        if (!res.ok) throw new Error(`${method} -> ${res.status} ${text.slice(0, 300)}`)
        if (notify) return undefined
        const messages: RpcMessage[] = (res.headers.get('content-type') ?? '').includes('text/event-stream')
            ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => JSON.parse(l.slice(5)))
            : [JSON.parse(text)]
        const msg = messages.find((m) => m.id === id)
        if (!msg) throw new Error(`${method}: no response for request ${id}`)
        if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`)
        return msg.result
    }

    async connect(): Promise<void> {
        await this.rpc('initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'summ-sync', version: '0.1.0' },
        })
        await this.rpc('notifications/initialized', undefined, { notify: true })
    }

    async listTools(): Promise<Tool[]> {
        return ((await this.rpc('tools/list', {})) as { tools: Tool[] }).tools
    }

    /** Calls a tool and returns its text. */
    async callTool(name: string, args: Record<string, unknown>): Promise<string> {
        if (!this.allowed.has(name)) throw new Error(`Refusing to call a tool this command may not use: ${name}`)
        const result = (await this.rpc('tools/call', { name, arguments: { context: CONTEXT, ...args } })) as ToolResult
        const text = (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')
        if (result.isError) throw new Error(`${name}: ${text.slice(0, 500)}`)
        await sleep(DELAY_MS)
        return text
    }
}
