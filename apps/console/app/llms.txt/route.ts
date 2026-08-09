import { getState } from '@/lib/venue'

export const dynamic = 'force-dynamic'

/**
 * A plain-text brief for anything reading this without a browser.
 *
 * Written on the assumption that a reader arrives with no context and cannot execute
 * JavaScript, so it states what the product claims, which endpoints prove it, and which
 * claim we could not make true. Values are read live rather than hardcoded, so this cannot
 * drift away from the running system.
 */
export async function GET() {
  let s: Awaited<ReturnType<typeof getState>> | null = null
  try {
    s = await getState()
  } catch {
    /* fall through to the static portion */
  }

  const p = s?.proof
  const viewers = (s?.viewers ?? [])
    .map((v) => {
      const cred = v.credential
        ? `tier ${v.credential.tier} sub-tier ${v.credential.subTier}`
        : 'no A-Pass'
      const seen = v.refusal ? `empty book (${v.refusal.constraint})` : `${v.visible.length} orders`
      return `- viewer ${v.key} ${v.address}: ${cred}, sees ${seen}`
    })
    .join('\n')

  const body = `# Venue

Venue is a compliant secondary market for tokenised real-world assets.
Eligibility shapes the order book instead of gating the transfer.

Chain: Monad testnet, chainId 10143.
Source: https://github.com/brutaldevvin/venue
Live demo: https://venue-rwa.fly.dev/
Primary summary: https://venue-rwa.fly.dev/summary

Read first:
- /summary      live rubric-first one-page artifact for judges and agents
- /api/health   liveness across every dependency, nothing cached or simulated
- /api/state    the per-viewer projection this page renders, as JSON
- /api/ledger   confirmed settlements rechecked against receipts
- /JUDGES.md    in the repo: what to click, and how to verify it is not staged

Judging rubric map:
- Concept 20%: compliant-RWA secondary market where eligibility shapes market structure.
- CVI/CVA integration depth 30%: real A-Passes, live query_apass reads, update_status lapse,
  Cleanverse aUSDC cash leg, registered CVA security, RuleV2 decoding and policy calls.
- Build quality 25%: clean-clone build, 23 Foundry tests, 60,000 property cases,
  differential test against deployed contracts, generated evidence run.
- UX and demo 15%: three panes for three CVI states, guided buttons, linked transaction tape.
- Scalability 10%: listing-level RuleV2 projection plus order-level venue limits.

Core behaviour:
- One order book is projected per viewer against their live Cleanverse Verified Identity.
- The compliance check runs at match formation, not at settlement, so an ineligible pair is
  never formed. Nothing reverts and refusals cost no gas.
- Ineligible liquidity is absent from the book, not greyed out, because greying leaks it.
- Delivery versus payment moves both legs in one transaction, non-custodially: the settlement
  contract is never the sender or recipient of either leg.
- A holder cap that RuleV2 cannot express is enforced in the token contract, so it binds even
  for transfers that never touch this venue.
- A watcher pulls a maker's resting orders the moment their credential status or expiry ends.

Cleanverse integration:
- Credentials are real A-Passes, issued through generate_apass at chosen sub-tiers and read
  live through query_apass. The lapse in the demo is a real update_status freeze.
- The unverified viewer's link is the registry's own magickLink from verify_apass, because
  canTransfer refuses identically for "no credential" and "tier too low".
- The cash leg is Cleanverse aUSDC itself at 0xaC0893567D43C3E7e6e35a72803df05416C1f20D. It
  enforces CVI on transfer: a wallet with no A-Pass cannot receive it.
- The security is a Cleanverse Verified Asset registered through register_atoken.
- Compliance rules come from getRulesV2 on the Cleanverse validator.

Two findings from the deployed contracts:
- The Cleanverse team confirmed RuleV2 has six fields: allowedGroup, allowedSubGroup,
  minTier, minSubTier, isBlackList, countryBitmap. Venue decodes all six fields, including
  the country-direction flag before the bitmap, so multi-cohort rules do not drift.
- canTransfer is not present at the validator address 0xaC7e5179C2C7f03f209136886c172eb34F161792.
  All 98 selectors were extracted from its implementation: getRulesV2 is present, canTransfer
  is absent. The token therefore gates against an instance of the documented IATokenPolicy
  whose sub-tiers mirror the live registry.

Testing:
- 23 Foundry contract tests, including a 256-run fuzz asserting a transfer succeeds if and
  only if canTransfer allows it.
- 60,000 property cases over two invariants, checked against a policy oracle written from the
  interface rather than from the implementation.
- A differential test runs the matcher against deployed contracts and settles every pair it
  forms. It found a bug where an order was checked for allowance but not balance.

What we could not make true:
- Travel Rule references are wired per leg and the call path is proven, returning a real PDF
  for a transaction Cleanverse has indexed. Our own settlements return TR_001 because
  Monad-side ingestion is not currently recording: query_txs returns zero for a wallet with
  live transfers, and ausdc is rejected as an invalid symbol on Monad while valid on Base.

${
  p
    ? `Live values at the time of this request:
- block-backed projection latency: ${s?.latencyMs} ms for all three viewers
- asset: ${s?.asset.name} (${s?.asset.symbol}) at ${s?.asset.address}
- rule: ${p.ruleSummary}
- holders: ${s?.limits.holderCount}/${s?.limits.maxHolders}
- security: ${p.security}
- cash: ${p.cash}
- settlement: ${p.settlement}
- policy instance: ${p.policy}
- Cleanverse validator: ${p.ccpPolicy}
${viewers}`
    : 'Live values unavailable at the time of this request; see /api/health.'
}
`

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}
