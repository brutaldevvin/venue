export type Address = `0x${string}`
export type Hex = `0x${string}`
/** bytes2, lowercase hex, always 6 chars: "0x0000" is unrestricted. */
export type Bytes2 = `0x${string}`

export const UNRESTRICTED_BYTES2: Bytes2 = '0x0000'

/**
 * The on-chain rule set, one entry of `getRulesV2(token)`.
 *
 * Within a rule the fields are AND; across the array the rules are OR - a holder is
 * eligible if they satisfy any one rule. Zero means unrestricted in every field.
 */
export interface RuleV2 {
  allowedGroup: Bytes2
  allowedSubGroup: Bytes2
  /** 0-99. 0 = unrestricted. */
  minTier: number
  /** 0-99. 0 = unrestricted. */
  minSubTier: number
  /**
   * Country membership as a 256-bit mask. 0n = unrestricted.
   *
   * The integration guide calls these "ISO 3166-1 numeric bit positions", but that cannot
   * be literally true: ISO numeric codes run to 894, and 1 << 840 does not fit a uint256.
   * With ~249 assigned countries the mask is exactly wide enough for a compact 0-255
   * ordinal, which is almost certainly what it holds. Both live reference CVAs carry 0
   * here, so the chain does not disambiguate it. Treated as an opaque index until the
   * mapping is confirmed - see the open question in BUILD-VENUE §12.
   */
  poolCountryBitmap: bigint
}

/**
 * A viewer's credential, resolved from the Cleanverse CVI registry.
 *
 * Shaped to what `query_apass` actually returns: `tier` arrives as a string and
 * `group`/`subGroup` as (possibly empty) ASCII, so resolution normalises before this
 * type is constructed. `countries` is a list of ISO 3166-1 numeric codes.
 */
export interface Credential {
  address: Address
  group: Bytes2
  subGroup: Bytes2
  tier: number
  subTier: number
  /** Country indices in the range 0-255, matching `RuleV2.poolCountryBitmap` bit positions. */
  countries: number[]
  /** 1 = active. Anything else fails eligibility outright. */
  status: number
  /** Unix seconds. */
  expirationTime: number
}

/** A viewer with no A-Pass at all - `query_apass` returned CN_001. Distinct from "fails the rules". */
export type ViewerCredential = Credential | null

/** An off-chain order, signed by the maker and held by the venue (BUILD-VENUE §10). */
export interface Order {
  id: string
  asset: Address
  maker: Address
  side: 'bid' | 'ask'
  price: bigint
  qty: bigint
  /** Unix seconds. */
  expiry: number
  nonce: bigint
  signature: Hex
}

/**
 * Venue-side state that gates individual orders, as opposed to RuleV2 which gates the
 * listing as a whole (decision D5). None of this is expressible in RuleV2, so none of it
 * can come from `canTransfer`.
 */
export interface VenueLimits {
  /** Unix seconds before which the asset cannot be traded at all. 0 = no lockup. */
  lockupUntil: number
  /** Max distinct holders. Advisory here; `Listed.sol` is authoritative (D2). */
  maxHolders: number
  /** Current on-chain holder count. */
  holderCount: number
  /** Max units any one address may hold. 0n = no limit. */
  positionLimit: bigint
}

/** Everything the venue knows about one viewer, beyond their credential. */
export interface ViewerState {
  /** Units of the security this viewer already holds. */
  position: bigint
  /** ERC-20 allowance granted to the settlement contract, per D7. */
  allowance: bigint
}

/** Why an order is not visible or not matchable. Drives the rule strip and the tape. */
export type RefusalReason =
  | 'no-credential'
  | 'credential-inactive'
  | 'credential-expired'
  | 'rule-set'
  | 'lockup'
  | 'holder-cap'
  | 'position-limit'
  | 'unfunded'
  | 'order-expired'

/** A refusal carries no PII - only the constraint that bound. */
export interface Refusal {
  reason: RefusalReason
  /** Human-readable constraint, e.g. "minSubTier >= 70". Safe to render and to log. */
  constraint: string
}
