/**
 * A small per-IP limiter for the mutating demo actions.
 *
 * Once this is public, `/api/run` spends real gas, moves real aUSDC and freezes A-Passes at
 * the Cleanverse registry. None of that is expensive on a testnet, but a visitor holding
 * down the button could drain the settlement agent's gas or leave the demo mid-lapse for
 * whoever looks next.
 *
 * Deliberately not a token: a judge should be able to press the buttons without a
 * credential. The limit is generous enough that ordinary use never sees it, and it is held
 * in memory rather than in a store, because the process is single and long-lived and a
 * dependency for this would be worse than the problem.
 */
interface Bucket {
  hits: number[]
}

const WINDOW_MS = 60_000
/**
 * Per caller, generous enough that ordinary use never sees it.
 *
 * This alone is not sufficient. Rotating IPv6 egress, which any VPN or privacy-preserving
 * network provides, hands out a fresh address per request, so every request opens its own
 * bucket and a per-caller limit never fires. Observed directly against this deployment: five
 * consecutive requests arrived from five different addresses whose prefixes diverged too
 * high up to group.
 */
const MAX_PER_WINDOW = 12
/**
 * Across all callers. This is the limit that actually protects the demo, because what is at
 * risk is a shared resource - the settlement agent's gas and the coherence of one order book
 * - rather than fairness between visitors. Generous for a judge clicking through the beats,
 * and low enough that a script cannot drain the wallet.
 */
const MAX_GLOBAL_PER_WINDOW = 30

const store: Map<string, Bucket> = ((globalThis as { __venueRate?: Map<string, Bucket> })
  .__venueRate ??= new Map())

export function clientKey(req: Request): string {
  // Behind a proxy the socket address is the proxy, so prefer the forwarded chain's origin.
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  return req.headers.get('fly-client-ip') ?? req.headers.get('x-real-ip') ?? 'unknown'
}

/** Diagnostics, so a limiter that silently never fires can be told apart from one that does. */
export function limiterState(): {
  trackedKeys: number
  globalHitsInWindow: number
  machine: string
  region: string
} {
  const now = Date.now()
  return {
    trackedKeys: store.size,
    globalHitsInWindow: globalBucket.hits.filter((t) => now - t < WINDOW_MS).length,
    machine: process.env.FLY_MACHINE_ID ?? 'unknown',
    region: process.env.FLY_REGION ?? 'unknown',
  }
}

const globalBucket: Bucket = ((globalThis as { __venueRateGlobal?: Bucket })
  .__venueRateGlobal ??= { hits: [] })

export function rateLimit(req: Request): { ok: true } | { ok: false; retryAfter: number } {
  const key = clientKey(req)
  const now = Date.now()

  globalBucket.hits = globalBucket.hits.filter((t) => now - t < WINDOW_MS)
  if (globalBucket.hits.length >= MAX_GLOBAL_PER_WINDOW) {
    const oldest = globalBucket.hits[0] as number
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) }
  }

  const bucket = store.get(key) ?? { hits: [] }

  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS)
  if (bucket.hits.length >= MAX_PER_WINDOW) {
    store.set(key, bucket)
    const oldest = bucket.hits[0] as number
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) }
  }

  bucket.hits.push(now)
  store.set(key, bucket)
  globalBucket.hits.push(now)

  // Keep the map from growing without bound on a long-lived process.
  if (store.size > 5_000) {
    for (const [k, v] of store) {
      if (v.hits.every((t) => now - t >= WINDOW_MS)) store.delete(k)
    }
  }
  return { ok: true }
}
