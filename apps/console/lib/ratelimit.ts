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
const MAX_PER_WINDOW = 12

const store: Map<string, Bucket> = ((globalThis as { __venueRate?: Map<string, Bucket> })
  .__venueRate ??= new Map())

export function clientKey(req: Request): string {
  // Behind a proxy the socket address is the proxy, so prefer the forwarded chain's origin.
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  return req.headers.get('fly-client-ip') ?? req.headers.get('x-real-ip') ?? 'unknown'
}

export function rateLimit(req: Request): { ok: true } | { ok: false; retryAfter: number } {
  const key = clientKey(req)
  const now = Date.now()
  const bucket = store.get(key) ?? { hits: [] }

  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS)
  if (bucket.hits.length >= MAX_PER_WINDOW) {
    store.set(key, bucket)
    const oldest = bucket.hits[0] as number
    return { ok: false, retryAfter: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) }
  }

  bucket.hits.push(now)
  store.set(key, bucket)

  // Keep the map from growing without bound on a long-lived process.
  if (store.size > 5_000) {
    for (const [k, v] of store) {
      if (v.hits.every((t) => now - t >= WINDOW_MS)) store.delete(k)
    }
  }
  return { ok: true }
}
