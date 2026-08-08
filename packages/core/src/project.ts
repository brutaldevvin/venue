import { bindingConstraint, credentialLive, eligible } from './rules'
import type {
  Address,
  Credential,
  Order,
  Refusal,
  RuleV2,
  VenueLimits,
  ViewerState,
} from './types'

/** Everything the venue knows about the book for one asset, at one instant. */
export interface BookState {
  asset: Address
  orders: readonly Order[]
  /** Resolved maker credentials. A maker absent from the map is treated as uncredentialed. */
  makerCredentials: ReadonlyMap<Address, Credential | null>
  /** Maker positions and allowances, for the liveness check in D7. */
  makerStates: ReadonlyMap<Address, ViewerState>
  /** `getRulesV2(asset)`. Empty means the policy does not govern this token. */
  rules: readonly RuleV2[]
  limits: VenueLimits
  /** Unix seconds. Passed in rather than read, so projection stays pure. */
  now: number
}

export interface Projection {
  /** The orders this viewer may see. Ineligible liquidity is absent, not greyed. */
  visible: Order[]
  /**
   * Why the book is empty for this viewer, or null if it is not empty for a compliance
   * reason. Carries no PII - only the constraint that bound.
   */
  refusal: Refusal | null
  /** Every venue-side constraint currently binding for this viewer, for the rule strip. */
  bound: Refusal[]
}

/**
 * Is a resting order live? A dead order is dropped silently from every projection - it is
 * not a refusal, because it is nobody's eligibility that failed.
 */
export function orderLive(order: Order, book: BookState): boolean {
  if (order.expiry <= book.now) return false

  const maker = book.makerCredentials.get(order.maker) ?? null
  if (!eligible(maker, book.rules, book.now)) return false

  // A resting order is backed by an approval to the settlement contract, and by the assets
  // to honour it. Checking the approval alone lets a maker offer securities they do not
  // hold: the pair forms, and settlement reverts with an insufficient balance. That is the
  // one way the matcher can cause a failed settlement, so both sides are checked.
  const state = book.makerStates.get(order.maker)
  if (state === undefined) return false

  if (order.side === 'ask') {
    return state.position >= order.qty && state.allowance >= order.qty
  }

  // A bid is funded from the cash leg. Where the caller does not track cash, the order is
  // treated as unfunded rather than assumed good, because guessing here is what produces a
  // revert at settlement.
  const notional = order.price * order.qty
  if (state.cashBalance === undefined || state.cashAllowance === undefined) return false
  return state.cashBalance >= notional && state.cashAllowance >= notional
}

/** The listing-level check (D5, first layer): does this viewer see the asset at all? */
function listingRefusal(
  viewer: Credential | null,
  book: BookState,
): Refusal | null {
  if (viewer === null) {
    return { reason: 'no-credential', constraint: 'no verified identity' }
  }
  if (viewer.status !== 1) {
    return { reason: 'credential-inactive', constraint: `status == 1 (is ${viewer.status})` }
  }
  if (viewer.expirationTime <= book.now) {
    return { reason: 'credential-expired', constraint: `expiry > now` }
  }
  if (!eligible(viewer, book.rules, book.now)) {
    // Rules are OR, so report the constraint from the rule the viewer came closest to
    // satisfying - the first one is as defensible as any and is stable across calls.
    const first = book.rules[0]
    const constraint = first ? (bindingConstraint(viewer, first) ?? 'rule set') : 'rule set'
    return { reason: 'rule-set', constraint }
  }
  if (book.limits.lockupUntil > book.now) {
    return { reason: 'lockup', constraint: `lockup until ${book.limits.lockupUntil}` }
  }
  return null
}

/**
 * Project the book for one viewer - the thesis, as a pure function.
 *
 * Two layers, per D5. `RuleV2` gates the listing: fail it and the book is empty, because
 * rules live on the token and cannot vary per order. Lockup, holder cap and position limit
 * are venue-side and gate individual orders. This is also why projection is not
 * O(viewers x orders): the expensive check runs once per viewer.
 */
export function project(
  viewer: Credential | null,
  viewerState: ViewerState,
  book: BookState,
): Projection {
  const refusal = listingRefusal(viewer, book)
  if (refusal !== null) return { visible: [], refusal, bound: [refusal] }

  const bound: Refusal[] = []

  // Taking an ask makes the viewer a holder. If the cap is full and they hold nothing,
  // every ask is untakeable - so it is absent, and the cap chip binds.
  const capBinds =
    viewerState.position === 0n && book.limits.holderCount >= book.limits.maxHolders
  if (capBinds) {
    bound.push({
      reason: 'holder-cap',
      constraint: `holders < ${book.limits.maxHolders} (at ${book.limits.holderCount})`,
    })
  }

  const headroom =
    book.limits.positionLimit === 0n
      ? null
      : book.limits.positionLimit - viewerState.position

  // The limit is reported whenever it actually removed an order, not only when headroom is
  // exhausted: a partially-filled position silently hides the asks that would overshoot it,
  // and liquidity that vanishes with nothing on the rule strip is the exact failure
  // invariant 2 exists to catch.
  let positionLimitBound = headroom !== null && headroom <= 0n

  const visible: Order[] = []
  for (const o of book.orders) {
    if (!orderLive(o, book)) continue
    if (o.side === 'ask') {
      if (capBinds) continue
      if (headroom !== null && o.qty > headroom) {
        positionLimitBound = true
        continue
      }
    }
    visible.push(o)
  }

  if (positionLimitBound) {
    bound.push({
      reason: 'position-limit',
      constraint: `position <= ${book.limits.positionLimit}`,
    })
  }

  return { visible, refusal: null, bound }
}

/**
 * The predicate the console renders from, and the one invariant 2 protects: it must never
 * hide an order the chain would allow. Kept separate from `project` so the property test
 * can address it directly.
 */
export function viewerEligible(
  viewer: Credential | null,
  rules: readonly RuleV2[],
  now: number,
): boolean {
  if (viewer === null) return false
  if (!credentialLive(viewer, now)) return false
  return eligible(viewer, rules, now)
}
