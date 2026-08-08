import fc from 'fast-check'
import type { Address, Credential, Order, RuleV2, VenueLimits, ViewerState } from '../src/types'

export const NOW = 1_800_000_000

const addr = (n: number): Address =>
  `0x${n.toString(16).padStart(40, '0')}` as Address

export const addressArb: fc.Arbitrary<Address> = fc.integer({ min: 1, max: 24 }).map(addr)

/** Two-letter ASCII, or empty for unrestricted - the shape query_apass actually returns. */
const groupAsciiArb = fc.constantFrom('', 'CD', 'AB', 'ZZ')

const bytes2Arb = fc.constantFrom<`0x${string}`>('0x0000', '0x4344', '0x4142', '0x5a5a')

/**
 * Country *indices*, not ISO 3166-1 numeric codes - see the note on `Credential.countries`.
 * Drawn from a small set so that intersections actually occur: a uniform draw over 0-255
 * makes the country clause almost never bind, and a clause that never binds is a clause
 * the property test never exercises.
 */
const countryArb = fc.uniqueArray(fc.constantFrom(4, 36, 124, 203, 249), { maxLength: 3 })

export const ruleArb: fc.Arbitrary<RuleV2> = fc.record({
  allowedGroup: bytes2Arb,
  allowedSubGroup: bytes2Arb,
  minTier: fc.integer({ min: 0, max: 99 }),
  minSubTier: fc.integer({ min: 0, max: 99 }),
  poolCountryBitmap: countryArb.map((cs) =>
    cs.reduce((m, c) => m | (1n << BigInt(c)), 0n),
  ),
  // Both directions, so neither branch of the country clause goes unexercised.
  isBlackList: fc.boolean(),
})

export const rulesArb: fc.Arbitrary<RuleV2[]> = fc.array(ruleArb, { maxLength: 3 })

export const credentialArb: fc.Arbitrary<Credential> = fc.record({
  address: addressArb,
  group: bytes2Arb,
  subGroup: bytes2Arb,
  tier: fc.integer({ min: 0, max: 99 }),
  subTier: fc.integer({ min: 0, max: 99 }),
  countries: countryArb,
  // Both live and dead credentials, so status and expiry get exercised.
  status: fc.constantFrom(1, 1, 1, 2),
  expirationTime: fc.constantFrom(NOW - 1, NOW + 86_400, NOW + 31_536_000),
})

/** Some viewers have no A-Pass at all - a different state from failing the rules. */
export const viewerArb: fc.Arbitrary<Credential | null> = fc.oneof(
  { weight: 5, arbitrary: credentialArb },
  { weight: 1, arbitrary: fc.constant(null) },
)

/**
 * Prices sit in a narrow band so that bids and asks actually cross. Drawn from a wide
 * range they almost never do, and a matcher that never matches makes invariant 1 pass
 * vacuously - which is worse than failing, because it looks like evidence.
 */
export const orderArb: fc.Arbitrary<Order> = fc
  .record({
    id: fc.uuid(),
    maker: addressArb,
    side: fc.constantFrom<'bid' | 'ask'>('bid', 'ask'),
    price: fc.bigInt({ min: 95n, max: 105n }),
    qty: fc.bigInt({ min: 1n, max: 100n }),
    // Mostly live, so the book is not dominated by expired orders.
    expiry: fc.constantFrom(NOW - 1, NOW + 3600, NOW + 3600, NOW + 3600),
  })
  .map((o) => ({
    ...o,
    asset: addr(1),
    nonce: 0n,
    signature: '0x00' as `0x${string}`,
  }))

/**
 * A credential built to satisfy a given rule, so that eligible makers are common rather
 * than accidental. The country clause is satisfied by picking a bit the rule actually set.
 */
function satisfying(r: RuleV2): fc.Arbitrary<Omit<Credential, 'address'>> {
  const bits: number[] = []
  for (let b = 0; b < 256; b++) if ((r.poolCountryBitmap >> BigInt(b)) & 1n) bits.push(b)

  return fc.record({
    group: fc.constant(r.allowedGroup === '0x0000' ? ('0x4344' as const) : r.allowedGroup),
    subGroup: fc.constant(
      r.allowedSubGroup === '0x0000' ? ('0x4344' as const) : r.allowedSubGroup,
    ),
    tier: fc.integer({ min: r.minTier, max: 99 }),
    subTier: fc.integer({ min: r.minSubTier, max: 99 }),
    // Satisfying a deny-list means holding none of its countries; satisfying an allow-list
    // means holding one of them.
    countries:
      bits.length === 0
        ? fc.constant([])
        : fc.constant(r.isBlackList ? [] : [bits[0] as number]),
    status: fc.constant(1),
    expirationTime: fc.constant(NOW + 86_400),
  })
}

export const viewerStateArb: fc.Arbitrary<ViewerState> = fc.record({
  position: fc.bigInt({ min: 0n, max: 200n }),
  allowance: fc.bigInt({ min: 0n, max: 100_000n }),
})

export const limitsArb: fc.Arbitrary<VenueLimits> = fc
  .record({
    maxHolders: fc.integer({ min: 0, max: 6 }),
    holderCount: fc.integer({ min: 0, max: 6 }),
    positionLimit: fc.constantFrom(0n, 50n, 200n),
    lockupUntil: fc.constantFrom(0, NOW - 1, NOW + 3600),
  })
  .map((l) => ({ ...l }))

/**
 * A whole book: orders plus resolved state for every maker in it.
 *
 * Makers are a mix of credentials built to satisfy the drawn rule set and freely random
 * ones. Without that bias almost no book ever produces a match, and the invariants pass
 * without ever having been exercised.
 */
export const bookArb = rulesArb.chain((rules) => {
  const first = rules[0]
  const makerCredArb: fc.Arbitrary<Credential | null> =
    first === undefined
      ? viewerArb
      : fc.oneof(
          { weight: 6, arbitrary: satisfying(first).map((c) => ({ ...c, address: addr(1) })) },
          { weight: 3, arbitrary: credentialArb },
          { weight: 1, arbitrary: fc.constant(null) },
        )

  return fc
    .record({
      orders: fc.array(orderArb, { maxLength: 8 }),
      rules: fc.constant(rules),
      limits: limitsArb,
      makers: fc.array(fc.tuple(addressArb, makerCredArb, viewerStateArb), { maxLength: 24 }),
    })
    .map(({ orders, rules, limits, makers }) => {
      const makerCredentials = new Map<Address, Credential | null>()
      const makerStates = new Map<Address, ViewerState>()
      for (const [a, cred, state] of makers) {
        makerCredentials.set(a, cred === null ? null : { ...cred, address: a })
        makerStates.set(a, state)
      }
      // Any maker the draw missed still needs an entry, or every order is trivially dead
      // and the properties pass vacuously.
      for (const o of orders) {
        if (!makerCredentials.has(o.maker)) makerCredentials.set(o.maker, null)
        if (!makerStates.has(o.maker)) {
          makerStates.set(o.maker, { position: 0n, allowance: 100_000n })
        }
      }
      return {
        asset: addr(1),
        orders,
        makerCredentials,
        makerStates,
        rules,
        limits,
        now: NOW,
      }
    })
})
