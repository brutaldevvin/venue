import type { Credential, RuleV2 } from '../src/types'

/**
 * A second, deliberately independent implementation of the policy's rule evaluation,
 * written straight from the interface in the CCP integration guide rather
 * than from `src/rules.ts`.
 *
 * The property tests are only worth running if the thing they check against was not
 * derived from the thing being checked. So this one works in decimal, iterates the country
 * bitmap bit by bit, and shares no helper with the implementation.
 */
function bytes2ToNumber(b: string): number {
  return parseInt(b.slice(2), 16)
}

/** Within a rule, all five fields are AND. Zero means unrestricted. */
export function oracleMatchesRule(v: Credential, r: RuleV2): boolean {
  const group = bytes2ToNumber(v.group)
  const subGroup = bytes2ToNumber(v.subGroup)
  const ruleGroup = bytes2ToNumber(r.allowedGroup)
  const ruleSubGroup = bytes2ToNumber(r.allowedSubGroup)

  if (ruleGroup !== 0 && group !== ruleGroup) return false
  if (ruleSubGroup !== 0 && subGroup !== ruleSubGroup) return false
  if (r.minTier !== 0 && v.tier < r.minTier) return false
  if (r.minSubTier !== 0 && v.subTier < r.minSubTier) return false

  if (r.countryBitmap !== 0n) {
    let hit = false
    for (let bit = 0; bit < 256; bit++) {
      const set = (r.countryBitmap >> BigInt(bit)) & 1n
      if (set === 1n && v.countries.includes(bit)) {
        hit = true
        break
      }
    }
    // A deny-list refuses on a hit; an allow-list refuses on a miss.
    if (r.isBlackList) {
      if (hit) return false
    } else if (!hit) {
      return false
    }
  }
  return true
}

/** Across the array, rules are OR. Status and expiry gate every rule. */
export function oracleEligible(
  v: Credential | null,
  rules: readonly RuleV2[],
  now: number,
): boolean {
  if (v === null) return false
  if (v.status !== 1) return false
  if (v.expirationTime <= now) return false
  if (rules.length === 0) return true
  for (const r of rules) {
    if (oracleMatchesRule(v, r)) return true
  }
  return false
}

/**
 * The oracle's stand-in for the on-chain `canTransfer`: a transfer is allowed exactly when
 * both parties satisfy the token's rule set. Note the real policy expresses "no" as a
 * revert rather than `false` (D4); that difference is exercised in the Foundry tests, not
 * here.
 */
export function oracleCanTransfer(
  from: Credential | null,
  to: Credential | null,
  rules: readonly RuleV2[],
  now: number,
): boolean {
  return oracleEligible(from, rules, now) && oracleEligible(to, rules, now)
}
