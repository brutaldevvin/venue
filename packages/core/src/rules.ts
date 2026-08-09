import type { Bytes2, Credential, RuleV2 } from './types'
import { UNRESTRICTED_BYTES2 } from './types'

/**
 * Encode the ASCII group/subGroup that `query_apass` returns ("CD", "") as the bytes2 that
 * `RuleV2` carries (0x4344, 0x0000). Left-aligned and zero-padded, which is how Solidity
 * lays out a short bytes literal.
 */
export function toBytes2(ascii: string): Bytes2 {
  if (ascii.length === 0) return UNRESTRICTED_BYTES2
  if (ascii.length > 2) throw new Error(`group/subGroup must be at most 2 chars, got "${ascii}"`)
  let hex = ''
  for (let i = 0; i < 2; i++) {
    const code = i < ascii.length ? ascii.charCodeAt(i) : 0
    if (code > 0xff) throw new Error(`group/subGroup must be ASCII, got "${ascii}"`)
    hex += code.toString(16).padStart(2, '0')
  }
  return `0x${hex}` as Bytes2
}

export function isUnrestricted(b: Bytes2): boolean {
  return BigInt(b) === 0n
}

/** Set of ISO 3166-1 numeric codes as the 256-bit mask `RuleV2` uses. */
export function countryBitmap(codes: readonly number[]): bigint {
  let mask = 0n
  for (const c of codes) {
    if (c < 0 || c > 255) throw new Error(`country code out of bitmap range: ${c}`)
    mask |= 1n << BigInt(c)
  }
  return mask
}

/**
 * Does this credential satisfy one rule? All five fields are AND.
 *
 * Pure and synchronous over an already-resolved credential - fetching and caching happen
 * outside, never in here. That is what makes the property tests possible.
 */
export function matches(v: Credential, r: RuleV2): boolean {
  if (!isUnrestricted(r.allowedGroup) && BigInt(v.group) !== BigInt(r.allowedGroup)) return false
  if (!isUnrestricted(r.allowedSubGroup) && BigInt(v.subGroup) !== BigInt(r.allowedSubGroup)) return false
  if (r.minTier !== 0 && v.tier < r.minTier) return false
  if (r.minSubTier !== 0 && v.subTier < r.minSubTier) return false
  if (!countryAllows(v, r)) return false
  return true
}

/**
 * The country clause, in both directions.
 *
 * An allow-list admits only holders whose country set overlaps the rule's; a deny-list
 * refuses exactly those. Inverting this would admit precisely the holders a sanctions or
 * jurisdiction rule exists to exclude, which is the most consequential way this function
 * could be wrong, so it is separated out and tested from both sides.
 */
export function countryAllows(v: Credential, r: RuleV2): boolean {
  if (r.countryBitmap === 0n) return true
  const overlaps = (countryBitmap(v.countries) & r.countryBitmap) !== 0n
  return r.isBlackList ? !overlaps : overlaps
}

/**
 * Is the credential usable at all, independent of any rule set? Status and expiry are CVI
 * facts rather than rule fields, so they gate every rule in the array.
 */
export function credentialLive(v: Credential, nowSeconds: number): boolean {
  return v.status === 1 && v.expirationTime > nowSeconds
}

/**
 * Eligibility for a listing: OR across the rule array, so one listing can carry several
 * cohorts. An empty array is unrestricted - the policy returns `[]` for a token it does not
 * govern, and such a token transfers as a plain ERC-20.
 */
export function eligible(v: Credential | null, rules: readonly RuleV2[], nowSeconds: number): boolean {
  if (v === null) return false
  if (!credentialLive(v, nowSeconds)) return false
  if (rules.length === 0) return true
  return rules.some((r) => matches(v, r))
}

/** The first field of `rule` that `v` fails, rendered for the rule strip. Null if it passes. */
export function bindingConstraint(v: Credential, r: RuleV2): string | null {
  if (!isUnrestricted(r.allowedGroup) && BigInt(v.group) !== BigInt(r.allowedGroup)) {
    return `group == ${r.allowedGroup}`
  }
  if (!isUnrestricted(r.allowedSubGroup) && BigInt(v.subGroup) !== BigInt(r.allowedSubGroup)) {
    return `subGroup == ${r.allowedSubGroup}`
  }
  if (r.minTier !== 0 && v.tier < r.minTier) return `tier >= ${r.minTier}`
  if (r.minSubTier !== 0 && v.subTier < r.minSubTier) return `subTier >= ${r.minSubTier}`
  if (!countryAllows(v, r)) {
    return r.isBlackList ? 'country not excluded' : 'country in pool'
  }
  return null
}
