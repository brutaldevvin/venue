import type { Address, Credential } from '@venue/core'
import { toBytes2 } from '@venue/core'
import type { CleanverseClient } from './client'
import type { ApassRecord } from './types'

/**
 * Normalise an A-Pass record into the credential the projection evaluates.
 *
 * Three shape mismatches the API forces on us, all handled here so that nothing downstream
 * has to know: `tier` arrives as a string, `group`/`subGroup` as ASCII rather than the
 * bytes2 `RuleV2` carries, and `countries` as an ISO list rather than a bitmap.
 */
export function toCredential(address: Address, record: ApassRecord): Credential {
  return {
    address,
    group: toBytes2(record.group ?? ''),
    subGroup: toBytes2(record.subGroup ?? ''),
    tier: Number.parseInt(record.tier ?? '0', 10) || 0,
    subTier: record.subTier ?? 0,
    countries: normaliseCountries(record),
    status: record.status,
    expirationTime: record.expirationTime,
  }
}

/**
 * `countries` comes back as ISO 3166-1 values that may be numeric or alpha-2 depending on
 * how the credential was issued; every demo wallet currently returns an empty list. Only
 * numeric codes can be placed in the bitmap, so anything else is dropped rather than
 * guessed - a wrong country bit is a wrong eligibility answer.
 */
function normaliseCountries(record: ApassRecord): number[] {
  const raw = (record as { countries?: unknown }).countries
  if (!Array.isArray(raw)) return []
  const out: number[] = []
  for (const c of raw) {
    const n = typeof c === 'number' ? c : Number.parseInt(String(c), 10)
    if (Number.isInteger(n) && n >= 0 && n <= 255) out.push(n)
  }
  return out
}

interface CacheEntry {
  value: Credential | null
  expiresAt: number
}

/**
 * Credential resolution with a short TTL.
 *
 * Projection is a pure function over already-resolved credentials, so every fetch happens
 * here and never inside the hot path. The TTL is deliberately short and the cache is
 * invalidated outright when the watcher sees a status change - a stale credential is the
 * one cache bug that would show a viewer liquidity they cannot legally trade.
 */
export class CredentialResolver {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly client: CleanverseClient,
    private readonly chain: string,
    private readonly ttlMs = 15_000,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async resolve(address: Address): Promise<Credential | null> {
    const key = address.toLowerCase()
    const hit = this.cache.get(key)
    if (hit && hit.expiresAt > this.now()) return hit.value

    const record = await this.client.queryApass({ chain: this.chain, address })
    const value = record === null ? null : toCredential(address, record)
    this.cache.set(key, { value, expiresAt: this.now() + this.ttlMs })
    return value
  }

  /** Resolve many at once - one call per distinct maker in the book. */
  async resolveAll(addresses: readonly Address[]): Promise<Map<Address, Credential | null>> {
    const distinct = [...new Set(addresses)]
    const pairs = await Promise.all(
      distinct.map(async (a) => [a, await this.resolve(a)] as const),
    )
    return new Map(pairs)
  }

  /** Called by the watcher on a CVI status or expiry event. */
  invalidate(address: Address): void {
    this.cache.delete(address.toLowerCase())
  }

  invalidateAll(): void {
    this.cache.clear()
  }
}
