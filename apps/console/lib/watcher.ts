import type { Address, Credential, Order } from '@venue/core'
import { credentialLive } from '@venue/core'

export interface WatcherDeps {
  /** Resting orders to police. */
  orders: () => Order[]
  /** Resolve a maker's current credential. Null means the credential is gone entirely. */
  resolve: (maker: Address) => Promise<Credential | null>
  /** Remove orders and record why. Called once per lapsed maker, not once per order. */
  cancel: (maker: Address, orderIds: string[], reason: string) => void
  now?: () => number
}

/**
 * Cancels resting orders when a maker's CVI status or expiry ends their eligibility.
 *
 * A lapsed maker's order would fail at settlement anyway - the watcher stops it reaching
 * that point, so the book never advertises liquidity that cannot legally trade. That is the
 * difference between "we check at the end" and Venue's claim.
 *
 * Expiry is checked as well as status, and it is the case a status-only watcher misses: a
 * credential that simply runs out emits no event, so polling is not an implementation
 * shortcut here but a correctness requirement.
 */
export class Watcher {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly deps: WatcherDeps,
    private readonly intervalMs = 5_000,
  ) {}

  async sweep(): Promise<{ cancelled: number; makers: Address[] }> {
    const now = Math.floor((this.deps.now?.() ?? Date.now()) / 1000)
    const orders = this.deps.orders()
    const makers = [...new Set(orders.map((o) => o.maker))]

    const lapsed: Address[] = []
    let cancelled = 0

    for (const maker of makers) {
      const cred = await this.deps.resolve(maker)
      const gone = cred === null
      const dead = cred !== null && !credentialLive(cred, now)
      if (!gone && !dead) continue

      const ids = orders.filter((o) => o.maker === maker).map((o) => o.id)
      if (ids.length === 0) continue

      this.deps.cancel(
        maker,
        ids,
        gone
          ? 'credential withdrawn'
          : cred!.status !== 1
            ? `status ${cred!.status}`
            : 'credential expired',
      )
      lapsed.push(maker)
      cancelled += ids.length
    }

    return { cancelled, makers: lapsed }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      // A sweep failure must not kill the loop - the sandbox 500s intermittently, and a
      // watcher that stops watching after one bad response is worse than none.
      this.sweep().catch(() => {})
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
