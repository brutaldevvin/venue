# Venue

**The compliant secondary market for real-world assets. Eligibility shapes the order book instead of gating the transfer.**

Monad testnet (chainId 10143) | [github.com/brutaldevvin/venue](https://github.com/brutaldevvin/venue)

---

## The problem

Tokenising a real-world asset is solved. Selling one is not. Private credit and fund shares sit untradeable because a trade needs a counterparty whose eligibility you can verify, and no venue can. Every compliant-RWA design lets anyone order and reverts at the end. A reverted transfer is a settlement break; a failed settlement is a fine.

## The solution

Venue makes eligibility a property of market microstructure rather than a post-hoc check. The book is projected per viewer against the live Cleanverse CVI registry, and the compliance check runs at **match formation** instead of at settlement. An ineligible pair is never formed, so nothing reverts and refusals cost no gas. Settlement re-verifies on chain, so an operator can hide liquidity but can never cause a bad trade.

The signature case: with the holder cap full, a better-priced bid from a new investor is passed over for a worse bid from an existing holder. Price-time priority violated by compliance, deliberately and lawfully, with the governing rule named on screen.

## CVI and CVA integration points

**CVI is read at four points.** At projection, each viewer's tier, sub-tier, group and country are evaluated against the asset's rule set; ineligible liquidity is **absent, not greyed**, because greying leaks the book. At match and again at settlement both sides are re-verified. A watcher pulls a maker's orders the moment their status or expiry ends.

The three demo identities are **real A-Passes**, issued through `generate_apass` at chosen sub-tiers and resolved live through `query_apass`. The unverified pane's link is the registry's own `magickLink` from `verify_apass`: `canTransfer` refuses identically for "no credential" and "tier too low", so only the API can say which. The lapse is a genuine `update_status` freeze at the registry, not a local edit.

**CVA on both legs.** The cash leg is **Cleanverse aUSDC itself** (`0xaC0893567D43C3E7e6e35a72803df05416C1f20D`), which enforces CVI on transfer: a wallet with no A-Pass cannot receive it. The security is a CVA registered through `register_atoken`. Delivery-versus-payment moves both legs in one transaction, non-custodially: the settlement contract is never `from` or `to` on either leg.

**Two findings from the deployed CCP contracts.** `RuleV2` returns **six** fields, not the five the integration guide documents; the sixth, `isBlackList`, inverts the country clause from an allow-list to a deny-list. A five-field decode reads a single rule correctly by luck and corrupts every rule after the first, which is exactly the multi-cohort case. Separately, `canTransfer` is **not present** at `0xaC7e5179C2C7f03f209136886c172eb34F161792`; extracting all 98 selectors from its implementation shows `getRulesV2` present and `canTransfer` absent. We therefore implement the documented `IATokenPolicy` and gate against an instance whose sub-tiers mirror live CVI, with the policy as a constructor argument so it repoints with no code change.

## Build quality

| | |
|---|---|
| Contract tests | 23 (Foundry), including a 256-run fuzz asserting a transfer succeeds iff `canTransfer` allows |
| Property tests | 60,000 cases across two invariants, checked against an independently written policy oracle |
| Differential test | Runs the matcher against deployed contracts and settles every pair it forms |

Each layer caught a real bug. The property tests found `project()` silently hiding asks that overshot a partially-filled position limit, which is the "operator quietly hides liquidity" hole. The differential test found `orderLive` checking a maker's allowance but never their balance, so the matcher could form a pair that reverted at settlement. Evidence is **generated, not transcribed**: `capture.ts` drives a live run and writes `EVIDENCE-RUN.md` with full hashes confirmed by receipt.

## Demo

Three panes, one asset, three CVI states. Viewer A (sub-tier 75) sees full depth; viewer B (sub-tier 9) an empty book naming the constraint; viewer C no A-Pass and a verification link. Press **two bids cross** to see the cap bind and a fill settle; press **a credential lapses** to watch the watcher pull that maker's orders.

Settled example, both legs in one transaction, zero reverts:
`0x133d7ffd82299c45fe59b24b375e1b80c91ddfaa21c1f250e223dd44b9b2d498`

## Scalability

Eligibility is two layers, which is what keeps projection cheap. `RuleV2` gates the **listing**, so it is evaluated once per viewer, not once per viewer x order; lockup, holder cap and position limit are venue-side and gate individual orders. Measured projection is 360-670 ms for three viewers, dominated by sequential RPC round-trips rather than by the projection itself.

## Honest limitation

Travel Rule references are wired per leg and the call path is proven, returning a real PDF for an indexed transfer. Our own settlements return `TR_001`, because Monad-side transaction ingestion is not currently recording: `query_txs` returns zero for a wallet with live transfers, and `ausdc` is rejected as an invalid symbol on Monad while valid on Base.
