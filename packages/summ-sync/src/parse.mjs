// Parsers for the Markdown that Summ's MCP tools return.

/**
 * query_summ_transactions: one "## n. <category> [TAGS]" block per action,
 * then "- **Key**: value" lines. Returns one object per action.
 */
export function parseActions(markdown) {
    return markdown
        .split(/^## \d+\. /m)
        .slice(1)
        .map((block) => {
            const [head, ...lines] = block.split('\n')
            const action = { tags: [...head.matchAll(/\[([A-Z_ ]+)\]/g)].map((m) => m[1]) }
            for (const line of lines) {
                const m = line.match(/^- \*\*(.+?)\*\*: (.*)$/)
                if (m) action[m[1]] = m[2].replace(/^`|`$/g, '').replace(/\\_/g, '_')
            }
            return action
        })
        .filter((a) => a['Action ID'])
}

/** query_summ_transactions page header: "(Page 2 of 5, 250 returned, 1100 total)". */
export function parsePageHeader(markdown) {
    const m = markdown.match(/Page (\d+) of (\d+), (\d+) returned, (\d+) total/)
    if (!m) throw new Error(`Unexpected page header: ${markdown.slice(0, 200)}`)
    const [page, pages, returned, total] = m.slice(1).map(Number)
    return { page, pages, returned, total }
}

/**
 * inspect_transaction: the action's JSON (the first ```json block) and the
 * "## Change History" lines ("<date> · <who> · <what changed>").
 */
export function parseDetail(markdown) {
    const json = markdown.match(/```json\n([\s\S]*?)\n```/)
    if (!json) throw new Error(`No action JSON in: ${markdown.slice(0, 200)}`)
    const history = (markdown.split(/^## Change History\s*$/m)[1] ?? '')
        .split(/^(?:---|## )/m)[0]
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    return { action: JSON.parse(json[1]), history }
}
