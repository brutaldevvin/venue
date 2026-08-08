import { describe, expect, it } from 'vitest'
import { countryAllows, countryBitmap, matches } from '../src/rules'
import type { Credential, RuleV2 } from '../src/types'
import { NOW } from './arbitraries'

const US = 3
const DE = 7
const SG = 11

const holder = (countries: number[]): Credential => ({
  address: '0x0000000000000000000000000000000000000001',
  group: '0x0000',
  subGroup: '0x4344',
  tier: 34,
  subTier: 75,
  countries,
  status: 1,
  expirationTime: NOW + 86_400,
})

const rule = (countries: number[], isBlackList: boolean): RuleV2 => ({
  allowedGroup: '0x0000',
  allowedSubGroup: '0x0000',
  minTier: 0,
  minSubTier: 0,
  poolCountryBitmap: countryBitmap(countries),
  isBlackList,
})

/**
 * The country clause is the one place where a sign error is silently catastrophic: an
 * inverted deny-list admits exactly the jurisdictions the rule exists to exclude, and
 * every other field would still evaluate correctly. Both directions are asserted directly
 * rather than inferred from each other.
 */
describe('country rules', () => {
  it('allow-list admits a listed country', () => {
    expect(countryAllows(holder([US]), rule([US, SG], false))).toBe(true)
  })

  it('allow-list refuses an unlisted country', () => {
    expect(countryAllows(holder([DE]), rule([US, SG], false))).toBe(false)
  })

  it('deny-list refuses a listed country', () => {
    expect(countryAllows(holder([US]), rule([US, SG], true))).toBe(false)
  })

  it('deny-list admits an unlisted country', () => {
    expect(countryAllows(holder([DE]), rule([US, SG], true))).toBe(true)
  })

  it('the two directions are genuinely opposite for the same inputs', () => {
    for (const held of [[US], [DE], [US, DE], []]) {
      const allow = countryAllows(holder(held), rule([US, SG], false))
      const deny = countryAllows(holder(held), rule([US, SG], true))
      expect(allow).toBe(!deny)
    }
  })

  it('an empty rule set is unrestricted in both directions', () => {
    expect(countryAllows(holder([US]), rule([], false))).toBe(true)
    expect(countryAllows(holder([US]), rule([], true))).toBe(true)
    expect(countryAllows(holder([]), rule([], true))).toBe(true)
  })

  /** A holder with no country tags cannot satisfy an allow-list, but breaches no deny-list. */
  it('an untagged holder fails an allow-list and passes a deny-list', () => {
    expect(countryAllows(holder([]), rule([US], false))).toBe(false)
    expect(countryAllows(holder([]), rule([US], true))).toBe(true)
  })

  it('composes with the rest of the rule', () => {
    const r = { ...rule([US], true), minSubTier: 70 }
    // Right country, but the sub-tier fails.
    expect(matches({ ...holder([DE]), subTier: 9 }, r)).toBe(false)
    expect(matches(holder([DE]), r)).toBe(true)
    // Sub-tier fine, but the country is denied.
    expect(matches(holder([US]), r)).toBe(false)
  })
})
