# Sends

A send moves a coin from one THORChain address to another with a `MsgSend`,
outside any protocol action. It gives one row per configured wallet it
touches: a `send` on the sending wallet, with the fee, and a `receive` on
the receiving wallet. Nothing is swapped, so a send between two configured
wallets is a transfer, and Summ pairs the two rows.

## Sources

Sends come from Midgard (`send` actions on THORChain). Midgard's history of
sends is incomplete before the chain upgrade of March 2022, and THORNode no
longer serves those txs, so Viewblock fills the gap:

| Sends | Source |
| --- | --- |
| From 2022-04-01 | Midgard |
| Before 2022-04-01 | Midgard, plus each Viewblock send with a txid Midgard does not list |

Viewblock is called only when a run exports a period that starts before
2022-04-01. Its address listing gives every tx of the wallet; only sends
dated before the cutoff are kept, and a send Midgard also lists is dropped,
so the overlap gives no second row. A run for a later period never calls
Viewblock, so if its unofficial API changes, only such runs are affected,
and they fail rather than lose sends.

Maya sends (Midgard `send` with `MAYA` or `CACAO`) are not mapped yet
(`maya.md`).

## Which sends give rows

A `MsgSend` with a memo can be another action's inbound: a swap paid by
`MsgSend` with an `=` memo, or a TCY unstake request (`tcy-` memo, no coins).
Midgard then lists the same txid twice, as a `send` and as the action
(`swap`, `tcy_unstake`). The action gives the rows; **a send whose txid is
also the inbound of another Midgard action gives none**.

A send with a swap memo and no such action gives a `send` row as usual: the
coin left the wallet, whatever the memo said.

A send with no coins (only a memo) moves nothing and gives no row.

A failed send (Midgard status `failed`; Viewblock `code` other than 0, e.g.
5 for an insufficient balance) moved nothing and gives no row. Its 0.02 RUNE
fee was still paid; fees of failed actions are not exported yet.

## Activity

Kind `send`, from the side of the wallet whose listing gave it (as TCY
distributions): a send between two configured wallets is mapped twice, once
for each.

| Wallet | Legs |
| --- | --- |
| Sender | out: principal, the coin sent (observed); out: gas, 0.02 RUNE (default) |
| Receiver | in: principal, the coin received (observed) |
| Both (a send to itself, e.g. an Arkeo delegation) | as the sender |

`details.purpose` is `delegate-arkeo` for a memo starting `delegate:arkeo:`.

## Fee

The fee is THORChain's native fee, 0.02 RUNE, paid in RUNE whatever coin is
sent, and only by the sender. Neither source states it per tx in what the
exporter reads:

- Midgard's `networkFees` on a send is 0.2 RUNE on every send in every year,
  and names the sent coin as its asset when the coin is not RUNE. THORNode
  shows 0.02 RUNE paid to the Reserve for the same txs, so Midgard's value is
  not used.
- Viewblock's address listing has no fee; its single-tx endpoint shows 0.02
  RUNE on sends from 2021 to 2026.

So the gas leg is the 0.02 RUNE default.

## Rows

| Row | Type | Base | Fee | From, to | Description |
| --- | --- | --- | --- | --- | --- |
| Sender | `send` | the coin and amount | 0.02 RUNE | sender, receiver | `Send <amount> <coin>; <txid>` |
| Receiver | `receive` | the coin and amount | — | sender, receiver | `Receive <amount> <coin>; <txid>` |
| Arkeo delegation | `send` | the coin and amount | 0.02 RUNE | the wallet, itself | `1/1 - DelegateArkeoWallet; <txid>` |

`<coin>` is `Synth DOGE` for a synth and `Trade BTC` for a trade asset;
otherwise the ticker. The blockchain is THORChain. The base currency is the
coin's name as every other row names it (`assets.md`), so a synth received
from a swap and later sent is one currency in Summ. Midgard and Viewblock
write TCY as `TCY`, which is `THOR.TCY`.
