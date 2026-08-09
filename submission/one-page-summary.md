# Venue

**Venue is a compliant secondary market for real-world assets: Cleanverse Verified Identity shapes the order book before a trade is formed, and Cleanverse Verified Assets settle both legs atomically on Monad.**

Verification links for judges and agents:

- Live demo: https://venue-rwa.fly.dev/
- Public repo: https://github.com/brutaldevvin/venue
- Health proof: https://venue-rwa.fly.dev/api/health
- Raw projected books: https://venue-rwa.fly.dev/api/state
- Settlement ledger: https://venue-rwa.fly.dev/api/ledger
- Agent brief: https://venue-rwa.fly.dev/llms.txt
- Evidence run: `EVIDENCE-RUN.md`
- Deployed chain: Monad testnet, chainId `10143`

## Concept, 20%

Tokenising a real-world asset is solved. Selling one is not. Private credit and fund shares sit untradeable because the venue must know whether the counterparty is eligible before it forms the trade. Waiting for a CVA transfer to revert creates settlement breaks.

Venue moves compliance into market structure. The book is projected per viewer against live CVI data; ineligible liquidity is absent, not greyed out, because greying leaks the book. The matcher checks compliance before forming a pair, so refusals cost no gas and no bad trade is sent to settlement. The signature case is a holder cap: a better-priced bid from a new investor is passed over for a worse bid from an existing holder, with the governing rule shown in the tape.

## CVI/CVA integration depth, 30%

CVI is used operationally, not as a label. Viewer credentials are real A-Passes issued through `generate_apass` and read live through `query_apass`. The demo shows three CVI states on one asset: viewer A has sub-tier 75 and sees full depth; viewer B has sub-tier 9 and sees an empty book with `subTier >= 70`; viewer C has no A-Pass and receives the registry `magickLink` from `verify_apass`. The lapse button calls `update_status` at the registry, and a watcher removes that maker's resting orders.

CVA is on both settlement legs. The cash leg is Cleanverse aUSDC itself, `0xaC0893567D43C3E7e6e35a72803df05416C1f20D`; a wallet with no A-Pass cannot receive it. The security is a CVA registered through `register_atoken`. Delivery-versus-payment moves security and cash in one transaction, non-custodially: the settlement contract is never `from` or `to` on either leg.

CCP integration is explicit. The Cleanverse team confirmed the complete `RuleV2` shape: `allowedGroup`, `allowedSubGroup`, `minTier`, `minSubTier`, `isBlackList`, `countryBitmap`. Venue decodes all six fields and handles `isBlackList` before `countryBitmap`, so country clauses and multi-cohort rules do not drift. The deployed Cleanverse validator exposes `getRulesV2` but not `canTransfer`, so Venue gates against an `IATokenPolicy`-compatible policy instance whose sub-tiers mirror live CVI. The policy is a constructor argument, so it can repoint without code changes.

## Build quality, 25%

The public repo has granular commits throughout the Aug 8-9 UTC hacking window, not a single bulk upload. Clean-clone checks pass: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm --filter @venue/console build`, and `pnpm test`.

Testing targets settlement safety: 23 Foundry contract tests including a 256-run fuzz where transfer success must match `canTransfer`; 60,000 property cases across two invariants checked against an independently written policy oracle; and a differential test that runs the matcher against deployed contracts and settles every pair it forms. These tests found real bugs during the build, including a matcher path that checked allowance but not balance.

Evidence is generated, not transcribed. `scripts/capture.ts` drives a live demo run and writes `EVIDENCE-RUN.md` with full transaction hashes confirmed by receipt. `/api/health` reports the current Monad block, CVI registry reads, configured contracts, holder cap, settlement-agent gas, and cash-leg asset check with `cache-control: no-store`.

## UX and demo, 15%

The demo is a 90-second, three-pane console. Before any click, the same asset renders differently for three viewers because their CVI states differ. Press **two bids cross** to see the holder cap bind and a fill settle; press **a credential lapses** to freeze a maker's A-Pass and watch the watcher pull their orders; press **reset** to restore the registry and book.

Confirmed settlement, both legs in one transaction, zero reverts: `0x133d7ffd82299c45fe59b24b375e1b80c91ddfaa21c1f250e223dd44b9b2d498`.

## Scalability, 10%

Eligibility is split into two layers. `RuleV2` gates the listing once per viewer. Venue-side limits such as holder cap, lockup and position limit gate individual orders. That keeps projection cheap, supports multiple investor cohorts per listing, and preserves chain safety because settlement re-verifies both CVA legs.

The hackathon deployment is intentionally one always-on Fly machine because the demo book and rate limiter are in memory. The production path is to persist the book, distribute the watcher, and point the constructor-configured policy at the canonical Cleanverse transfer policy when available.

## Known limitation

Travel Rule calls are wired per settlement leg and return a real PDF for Cleanverse-indexed transfers. Venue's Monad settlements currently return `TR_001` because Monad-side ingestion is not recording them: `query_txs` returns zero for a wallet with live transfers, and `ausdc` is rejected as an invalid Monad symbol while accepted on Base. The limitation is documented rather than hidden.
