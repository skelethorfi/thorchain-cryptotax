import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseActions, parseDetail, parsePageHeader } from '../src/parse.mjs'

// Shaped like query_summ_transactions output; every value is made up.
const PAGE = `# Transactions (Page 2 of 3, 2 returned, 502 total)

## 1. transfer
- **Action ID**: \`0000000000000000000000a1\`
- **Tx Hash**: \`2024-01-01T00:00:00.000Z.out.aaaaaaaaaaaa\`
- **Date**: 2024-01-01T00:00:00.000Z
- **Action Category**: transfer
- **From**: Wallet\\_A | rawAddress: wallet-a
- **Outgoing**: 1 RUNE (5.00)

## 2. income [IGNORED] [UNCATEGORISED]
- **Action ID**: \`0000000000000000000000a2\`
- **Tx Hash**: \`example-manual\`
- **Incoming**: 2 RUNE (10.00)

_Use page: 3 to see the next page._
`

test('parseActions reads each action block', () => {
    const actions = parseActions(PAGE)
    assert.equal(actions.length, 2)
    assert.equal(actions[0]['Action ID'], '0000000000000000000000a1')
    assert.equal(actions[0]['Tx Hash'], '2024-01-01T00:00:00.000Z.out.aaaaaaaaaaaa')
    assert.equal(actions[0].From, 'Wallet_A | rawAddress: wallet-a')
    assert.deepEqual(actions[0].tags, [])
    assert.deepEqual(actions[1].tags, ['IGNORED', 'UNCATEGORISED'])
})

test('parseActions ignores text without an action id', () => {
    assert.deepEqual(parseActions('# Transactions (Page 1 of 1, 0 returned, 0 total)\n\nNo transactions found.'), [])
})

test('parsePageHeader reads page, pages, returned and total', () => {
    assert.deepEqual(parsePageHeader(PAGE), { page: 2, pages: 3, returned: 2, total: 502 })
    assert.throws(() => parsePageHeader('something else'), /Unexpected page header/)
})

// Shaped like inspect_transaction output; every value is made up.
const DETAIL = `# Transaction Detail: \`0000000000000000000000a1\`

\`\`\`json
{
  "_id": "0000000000000000000000a1",
  "ids": ["2024-01-01T00:00:00.000Z.out.aaaaaaaaaaaa"],
  "type": "transfer",
  "outgoing": [{ "_id": "00000000000000000000b001", "id": "2024-01-01T00:00:00.000Z.out.aaaaaaaaaaaa", "trade": "withdrawal", "quantity": 1 }]
}
\`\`\`

## Cost Basis Breakdown

\`\`\`json
{ "00000000000000000000b001": { "breakdown": [] } }
\`\`\`

## Change History

1 Jan 2024 10:00 · user (original)
2 Jan 2024 11:00 · user · Quantity: 2 → 1

---
_Applied to: your account (self)_
`

test('parseDetail returns the action JSON and the change history', () => {
    const { action, history } = parseDetail(DETAIL)
    assert.equal(action._id, '0000000000000000000000a1')
    assert.equal(action.outgoing[0]._id, '00000000000000000000b001')
    assert.deepEqual(history, ['1 Jan 2024 10:00 · user (original)', '2 Jan 2024 11:00 · user · Quantity: 2 → 1'])
})

test('parseDetail with no change history section gives an empty history', () => {
    const { history } = parseDetail('```json\n{"_id":"x"}\n```\n')
    assert.deepEqual(history, [])
})

test('parseDetail refuses text without action JSON', () => {
    assert.throws(() => parseDetail('nothing here'), /No action JSON/)
})
