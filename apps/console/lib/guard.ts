import { randomUUID } from 'node:crypto'
import type { Review } from '@venue/guard'

// An approval applies once to the exact transaction and findings shown to the user.
// Keep it server-side: the browser cannot manufacture an approval using a boolean.
const state = ((globalThis as { __venueGuard?: {
  busy: boolean
  pending: Map<string, { action: string; fingerprint: string; expires: number }>
} }).__venueGuard ??= { busy: false, pending: new Map() })

function fingerprint(review: Review): string {
  return JSON.stringify([review.request, review.verdict.findings])
}

export function beginRun(): boolean {
  if (state.busy) return false
  state.busy = true
  return true
}
export function endRun(): void { state.busy = false }

export function takeApproval(token: unknown, action: string): string | undefined {
  if (typeof token !== 'string') return undefined
  const pending = state.pending.get(token)
  state.pending.delete(token)
  if (!pending || pending.action !== action || pending.expires <= Date.now()) return undefined
  return pending.fingerprint
}
export function matchesApproval(approval: string | undefined, review: Review): boolean {
  return approval === fingerprint(review)
}
export function offerApproval(action: string, review: Review): string {
  for (const [key, value] of state.pending) {
    if (value.expires <= Date.now()) state.pending.delete(key)
  }
  // Bound memory even if callers repeatedly abandon confirmation dialogs.
  if (state.pending.size >= 100) state.pending.delete(state.pending.keys().next().value!)
  const token = randomUUID()
  state.pending.set(token, {
    action, fingerprint: fingerprint(review),
    expires: Math.min(Date.parse(review.verdict.expiresAt), Date.now() + 60_000),
  })
  return token
}
