import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { project, viewerEligible } from '../src/project'
import { runMatcher } from '../src/match'
import { orderLive } from '../src/project'
import type { Address } from '../src/types'
import { bookArb, NOW, viewerArb, viewerStateArb } from './arbitraries'
import { oracleCanTransfer, oracleEligible } from './oracle'

/** Case counts are cited in the submission text, so they are asserted, not just configured. */
const RUNS = 20_000

describe('invariant 1 - no matched pair violates the rule set', () => {
  it('holds over randomised rule sets x credential states x books', async () => {
    let cases = 0
    let pairs = 0

    await fc.assert(
      fc.asyncProperty(bookArb, async (book) => {
        cases++
        const canTransfer = (from: `0x${string}`, to: `0x${string}`, _amount: bigint) =>
          oracleCanTransfer(
            book.makerCredentials.get(from) ?? null,
            book.makerCredentials.get(to) ?? null,
            book.rules,
            book.now,
          )

        const { matches } = await runMatcher(book, canTransfer)

        for (const m of matches) {
          pairs++
          const buyer = book.makerCredentials.get(m.bid.maker) ?? null
          const seller = book.makerCredentials.get(m.ask.maker) ?? null

          // The claim in the submission: the chain would not refuse anything we formed.
          expect(oracleEligible(buyer, book.rules, book.now)).toBe(true)
          expect(oracleEligible(seller, book.rules, book.now)).toBe(true)

          // A formed pair must also be a real cross of two live orders.
          expect(m.bid.price >= m.ask.price).toBe(true)
          expect(m.qty > 0n).toBe(true)
          expect(m.bid.maker).not.toBe(m.ask.maker)
          expect(orderLive(m.bid, book)).toBe(true)
          expect(orderLive(m.ask, book)).toBe(true)
        }

        // The holder cap is the constraint RuleV2 cannot express, so it is checked here
        // rather than left to canTransfer (D2).
        const newHolders = new Set(
          matches.filter((m) => m.consumesHolderSlot).map((m) => m.bid.maker),
        )
        expect(book.limits.holderCount + newHolders.size).toBeLessThanOrEqual(
          Math.max(book.limits.maxHolders, book.limits.holderCount),
        )
        return true
      }),
      { numRuns: RUNS },
    )

    expect(cases).toBe(RUNS)
    console.log(`invariant 1: ${cases} cases, ${pairs} matched pairs`)
  })
})

describe('invariant 2 - the local predicate never hides what canTransfer would allow', () => {
  it('listing-level: viewerEligible agrees with the policy oracle', () => {
    let cases = 0

    fc.assert(
      fc.property(viewerArb, bookArb, (viewer, book) => {
        cases++
        const allowed = oracleEligible(viewer, book.rules, book.now)
        const shown = viewerEligible(viewer, book.rules, book.now)

        // The direction that matters: an operator must not be able to hide the book from
        // someone the chain would let trade.
        if (allowed) expect(shown).toBe(true)
        // The converse protects the zero-reverts claim.
        if (shown) expect(allowed).toBe(true)
        return true
      }),
      { numRuns: RUNS },
    )

    expect(cases).toBe(RUNS)
    console.log(`invariant 2 (listing): ${cases} cases`)
  })

  it('order-level: every allowed, live order is visible unless a venue limit is reported', () => {
    let cases = 0
    let checked = 0

    fc.assert(
      fc.property(viewerArb, viewerStateArb, bookArb, (viewer, viewerState, book) => {
        cases++
        const p = project(viewer, viewerState, book)
        if (!oracleEligible(viewer, book.rules, book.now)) {
          // Not eligible for the listing at all - the book must be empty and say why.
          expect(p.visible).toHaveLength(0)
          expect(p.refusal).not.toBeNull()
          return true
        }
        if (book.limits.lockupUntil > book.now) {
          expect(p.refusal?.reason).toBe('lockup')
          return true
        }

        const visible = new Set(p.visible.map((o) => o.id))
        for (const o of book.orders) {
          const makerOk = oracleEligible(
            book.makerCredentials.get(o.maker) ?? null,
            book.rules,
            book.now,
          )
          // Only orders the chain would honour are in scope for this invariant.
          if (!makerOk || !orderLive(o, book)) continue
          checked++
          if (visible.has(o.id)) continue

          // Hidden despite being allowed: legitimate only if a venue-side limit bound,
          // and only ever for an ask, since taking an ask is what consumes a slot.
          expect(o.side).toBe('ask')
          expect(p.bound.length).toBeGreaterThan(0)
          expect(
            p.bound.some((b) => b.reason === 'holder-cap' || b.reason === 'position-limit'),
          ).toBe(true)
        }
        return true
      }),
      { numRuns: RUNS },
    )

    expect(cases).toBe(RUNS)
    console.log(`invariant 2 (order): ${cases} cases, ${checked} allowed orders checked`)
  })
})

describe('the signature case - a better bid passed over for a worse one', () => {
  it('cites the holder cap and names the order it skipped', async () => {
    const cred = {
      group: '0x0000' as const,
      subGroup: '0x4344' as const,
      tier: 20,
      subTier: 9,
      countries: [] as number[],
      status: 1,
      expirationTime: NOW + 86_400,
    }
    const seller = '0x0000000000000000000000000000000000000001' as const
    const incumbent = '0x0000000000000000000000000000000000000002' as const
    const newcomer = '0x0000000000000000000000000000000000000003' as const

    const order = (id: string, maker: Address, side: 'bid' | 'ask', price: bigint) => ({
      id,
      asset: seller,
      maker,
      side,
      price,
      qty: 10n,
      expiry: NOW + 3600,
      nonce: 0n,
      signature: '0x00' as const,
    })

    const book = {
      asset: seller,
      orders: [
        order('ask-1', seller, 'ask', 100n),
        order('bid-better', newcomer, 'bid', 120n),
        order('bid-worse', incumbent, 'bid', 110n),
      ],
      makerCredentials: new Map([
        [seller, { ...cred, address: seller }],
        [incumbent, { ...cred, address: incumbent }],
        [newcomer, { ...cred, address: newcomer }],
      ]),
      // Cash state matters now: a bid is only live if the maker can actually pay for it,
      // which is what stops the matcher forming a pair that reverts at settlement.
      makerStates: new Map([
        [seller, { position: 1000n, allowance: 10_000n, cashBalance: 0n, cashAllowance: 0n }],
        [
          incumbent,
          { position: 50n, allowance: 10_000n, cashBalance: 5_000_000n, cashAllowance: 5_000_000n },
        ],
        [
          newcomer,
          { position: 0n, allowance: 10_000n, cashBalance: 5_000_000n, cashAllowance: 5_000_000n },
        ],
      ]),
      rules: [],
      // The cap is full: 99 of 99.
      limits: { lockupUntil: 0, maxHolders: 99, holderCount: 99, positionLimit: 0n },
      now: NOW,
    }

    const { matches, skips } = await runMatcher(book, () => true)

    // Price-time priority says the newcomer's 120 wins. Compliance says otherwise.
    expect(matches).toHaveLength(1)
    expect(matches[0]?.bid.id).toBe('bid-worse')
    expect(matches[0]?.price).toBe(100n)

    expect(skips).toHaveLength(1)
    expect(skips[0]?.order.id).toBe('bid-better')
    expect(skips[0]?.reason).toBe('holder-cap')
    expect(skips[0]?.constraint).toContain('99')
  })
})
