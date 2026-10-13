import type { BookState } from './project'
import { orderLive } from './project'
import { eligible } from './rules'
import type { Order, RefusalReason } from './types'

/** A pair the matcher formed. Both sides passed `canTransfer` before this existed. */
export interface Match {
  bid: Order
  ask: Order
  qty: bigint
  /** Price-time priority gives the resting order's price. */
  price: bigint
  /** True if the buyer holds nothing yet, so settling consumes a holder slot. */
  consumesHolderSlot: boolean
}

/**
 * An order the matcher passed over, and the constraint that skipped it. This is the demo's
 * money shot - a better bid losing to a worse one - so the reason is a first-class result,
 * not a log line. It carries no PII.
 */
export interface Skip {
  order: Order
  againstOrderId: string
  reason: RefusalReason
  constraint: string
}

export interface MatchRun {
  matches: Match[]
  skips: Skip[]
}

/**
 * The compliance oracle. In production this is an `eth_call` to the policy's `canTransfer`
 * wrapped in try/catch, because the policy reverts rather than returning false (D4). The
 * matcher never reimplements the policy - it asks it (D6).
 */
export type CanTransfer = (from: `0x${string}`, to: `0x${string}`, amount: bigint) => boolean | Promise<boolean>

/** Price-time priority: best price first, arrival order breaking ties. */
function sortSide(orders: Order[], side: 'bid' | 'ask'): Order[] {
  const seq = new Map(orders.map((o, i) => [o.id, i]))
  return [...orders].sort((a, b) => {
    if (a.price !== b.price) {
      const better = side === 'bid' ? b.price - a.price : a.price - b.price
      return better > 0n ? 1 : -1
    }
    return (seq.get(a.id) ?? 0) - (seq.get(b.id) ?? 0)
  })
}

/**
 * Run the book, forming only pairs that the policy and the venue's own limits both allow.
 *
 * An ineligible pair is never formed, so nothing reverts and refusals cost no gas. Holder
 * slots are reserved as matches form - `available = maxHolders - holderCount - pending` -
 * which is advisory only, since `Listed.sol` is authoritative (D2).
 */
export async function runMatcher(book: BookState, canTransfer: CanTransfer): Promise<MatchRun> {
  const live = book.orders.filter((o) => orderLive(o, book))
  const bids = sortSide(live.filter((o) => o.side === 'bid'), 'bid')
  const asks = sortSide(live.filter((o) => o.side === 'ask'), 'ask')

  const matches: Match[] = []
  const skips: Skip[] = []
  const filled = new Map<string, bigint>()
  const remaining = (o: Order) => o.qty - (filled.get(o.id) ?? 0n)

  // A venue-side refusal is a property of the bid, not of the ask it was tried against, so
  // it is recorded once. Without this a bid blocked by the cap emits one skip per ask in
  // the book, and the tape reports the same refusal several times over.
  const refused = new Set<string>()
  let pendingNewHolders = 0
  const slotsFree = () =>
    book.limits.maxHolders - book.limits.holderCount - pendingNewHolders

  // Buyers who already hold, or who have been granted a slot in this run, do not need
  // another one - two fills to the same new buyer consume one slot, not two.
  const granted = new Set<`0x${string}`>()
  const holdsAlready = (addr: `0x${string}`) => {
    const s = book.makerStates.get(addr)
    return s !== undefined && s.position > 0n
  }

  for (const ask of asks) {
    for (const bid of bids) {
      if (remaining(ask) === 0n) break
      if (remaining(bid) === 0n) continue
      if (bid.price < ask.price) break // no cross, and bids are sorted - nothing better follows
      if (bid.maker === ask.maker) continue
      if (refused.has(bid.id)) continue

      // D5 layer one: the listing's rule set, both directions.
      const buyerCred = book.makerCredentials.get(bid.maker) ?? null
      const sellerCred = book.makerCredentials.get(ask.maker) ?? null
      if (!eligible(sellerCred, book.rules, book.now)) continue
      if (!eligible(buyerCred, book.rules, book.now)) {
        skips.push({
          order: bid,
          againstOrderId: ask.id,
          reason: 'rule-set',
          constraint: 'buyer fails the asset rule set',
        })
        refused.add(bid.id)
        continue
      }

      const qty = remaining(bid) < remaining(ask) ? remaining(bid) : remaining(ask)

      // D5 layer two: venue-side. RuleV2 has no cap field, so canTransfer will never
      // refuse for this - which is exactly why it is also enforced in Listed.sol (D2).
      const needsSlot = !holdsAlready(bid.maker) && !granted.has(bid.maker)
      if (needsSlot && slotsFree() <= 0) {
        skips.push({
          order: bid,
          againstOrderId: ask.id,
          reason: 'holder-cap',
          constraint: `holders < ${book.limits.maxHolders} (at ${book.limits.holderCount})`,
        })
        refused.add(bid.id)
        continue
      }

      if (book.limits.positionLimit !== 0n) {
        const held = book.makerStates.get(bid.maker)?.position ?? 0n
        if (held + qty > book.limits.positionLimit) {
          skips.push({
            order: bid,
            againstOrderId: ask.id,
            reason: 'position-limit',
            constraint: `position <= ${book.limits.positionLimit}`,
          })
          refused.add(bid.id)
          continue
        }
      }

      // D6: the policy itself decides, at match formation, off-chain and free.
      if (!(await canTransfer(ask.maker, bid.maker, qty))) {
        skips.push({
          order: bid,
          againstOrderId: ask.id,
          reason: 'rule-set',
          constraint: 'canTransfer refused',
        })
        continue
      }

      matches.push({ bid, ask, qty, price: ask.price, consumesHolderSlot: needsSlot })
      filled.set(bid.id, (filled.get(bid.id) ?? 0n) + qty)
      filled.set(ask.id, (filled.get(ask.id) ?? 0n) + qty)
      if (needsSlot) {
        granted.add(bid.maker)
        pendingNewHolders++
      }
    }
  }

  return { matches, skips }
}
