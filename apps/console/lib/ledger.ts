/**
 * A public, append-only record of every settlement this demo has ever made.
 *
 * Kept in a separate repository, brutaldevvin/venue-data, rather than in the submission
 * repo. The write token is scoped to that repo alone, so the worst a flood or a leaked token
 * can do is add noise to a data repo. Nothing can reach the repository being judged.
 *
 * The record is an index, not the evidence. Every entry carries a transaction hash, and the
 * chain is what proves it happened, which is why entries are verified against a receipt
 * before they are shown rather than trusted because we wrote them.
 */
const OWNER = 'brutaldevvin'
const REPO = 'venue-data'
const PATH = 'settlements.json'
const RAW = `https://raw.githubusercontent.com/${OWNER}/${REPO}/main/${PATH}`
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`

export interface SettlementRecord {
  txHash: string
  at: string
  qty: string
  price: string
  notional: string
  seller: string
  buyer: string
  security: string
  cash: string
  settlement: string
  chainId: number
}

interface LedgerCache {
  records: SettlementRecord[]
  sha: string | null
  fetchedAt: number
  /** Written but not yet pushed, so a GitHub outage never loses a settlement from the page. */
  pending: SettlementRecord[]
}

const cache: LedgerCache = ((globalThis as { __venueLedger?: LedgerCache }).__venueLedger ??= {
  records: [],
  sha: null,
  fetchedAt: 0,
  pending: [],
})

const TTL_MS = 30_000

function token(): string | null {
  return process.env.VENUE_DATA_TOKEN || null
}

/** Read the published record. Falls back to whatever is cached if GitHub is unreachable. */
export async function readLedger(): Promise<SettlementRecord[]> {
  const now = Date.now()
  if (cache.records.length > 0 && now - cache.fetchedAt < TTL_MS) {
    return [...cache.pending, ...cache.records]
  }
  try {
    const res = await fetch(`${RAW}?t=${now}`, { cache: 'no-store' })
    if (res.ok) {
      const parsed = (await res.json()) as SettlementRecord[]
      if (Array.isArray(parsed)) {
        cache.records = parsed
        cache.fetchedAt = now
      }
    }
  } catch {
    // Leave the cache as it is; a stale ledger beats a blank one.
  }
  return [...cache.pending, ...cache.records]
}

/** The current file SHA, which the contents API requires in order to replace it. */
async function currentSha(): Promise<{ sha: string | null; records: SettlementRecord[] }> {
  const t = token()
  if (!t) return { sha: null, records: [] }
  const res = await fetch(API, {
    headers: { authorization: `Bearer ${t}`, accept: 'application/vnd.github+json' },
    cache: 'no-store',
  })
  if (res.status === 404) return { sha: null, records: [] }
  if (!res.ok) throw new Error(`github contents ${res.status}`)
  const body = (await res.json()) as { sha: string; content: string }
  const decoded = Buffer.from(body.content, 'base64').toString('utf8')
  return { sha: body.sha, records: JSON.parse(decoded) as SettlementRecord[] }
}

/**
 * Append a settlement and publish it.
 *
 * Two settlements landing together would both write against the same SHA and the second
 * would be rejected, so the read-modify-write is retried against the fresh SHA. The record
 * is added to `pending` first, so the page shows it immediately even if publishing fails.
 */
export async function appendSettlement(record: SettlementRecord): Promise<{ published: boolean }> {
  cache.pending = [record, ...cache.pending]

  const t = token()
  if (!t) return { published: false }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { sha, records } = await currentSha()
      if (records.some((r) => r.txHash.toLowerCase() === record.txHash.toLowerCase())) {
        cache.pending = cache.pending.filter((p) => p.txHash !== record.txHash)
        return { published: true }
      }
      const next = [record, ...records]
      const res = await fetch(API, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${t}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: `settlement ${record.txHash.slice(0, 12)}: ${record.qty} @ ${record.price}`,
          content: Buffer.from(`${JSON.stringify(next, null, 2)}\n`).toString('base64'),
          ...(sha ? { sha } : {}),
        }),
      })
      if (res.ok) {
        cache.records = next
        cache.fetchedAt = Date.now()
        cache.pending = cache.pending.filter((p) => p.txHash !== record.txHash)
        return { published: true }
      }
      // 409 is a concurrent write; anything else is worth one more try too.
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    } catch {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  return { published: false }
}
