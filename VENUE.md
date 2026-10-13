# Venue — RWA track

**The compliant secondary market. Not a transfer that reverts — a trade that was never
enterable.**

Capability breadth: **5** (CVI, CVA, CCP Protocol, API/SDK, Agent Skill Framework).

Deliberately five. Venue is the only candidate that depends on **no unverified sandbox
capability** — not `update_status`, not Gateway Network, not Clean Payment Rails, not
Playground. It needs live CVI reads, CVA transfer restrictions, CCP pre-checks and the v3 API:
the four things cx402 already exercised. It survives all three day-one API tests failing.

It is also the only candidate that builds the *other half* of the track. The track names
tokenization platforms, secondary markets, and settlement pipelines. Every other team will
build the first. Issuance is not why tokenized RWAs have failed — illiquidity is.

---

## 1. Application form

### Project Name
```
Venue
```

### Track
```
RWA — Real-World Assets, Verified
```

### Team / Company
```
brutaldevvin
```

### Contact Email
```
can722812@gmail.com
```

### Project Description

The first sentence is tuned to the ~200-character truncation window: `(CVA)` closes at
roughly character 188, so both tag-bearing terms survive the cut with the thesis intact.

```
Venue is the compliant secondary market for real-world assets: an order book where Cleanverse Verified Identity (CVI) sets the liquidity you can see, and Cleanverse Verified Assets (CVA) settle both legs.

CLEANVERSE CAPABILITIES USED: CVI, CVA, CCP Protocol, API/SDK, Agent Skill Framework. Chain: Monad.

THE PROBLEM: Tokenizing a real-world asset is solved. Selling one is not. Private credit and fund shares sit untradeable - a trade needs a counterparty whose eligibility you can verify, and no venue can. Venues let anyone order, then revert at the end: a reverted transfer is a break, a failed settlement a fine.

THE SOLUTION: Venue makes eligibility a property of market microstructure, not a post-hoc check. The rule set shapes the book instead of gating the transfer. The book is projected per viewer against the live Cleanverse CVI registry; the matcher eth_calls the policy's canTransfer at match formation, so ineligible pairs never form and refusals cost no gas. Settlement calls it again on-chain: an operator can hide liquidity but never cause a bad trade.

WHAT WE BUILD: an eligibility-projected order book, a holder-cap-aware Cleanverse CCP matcher, an atomic delivery-versus-payment contract settling both legs in Cleanverse CVA, a watcher cancelling orders on CVI lapse, a settlement agent under EIP-191 mandate, a three-pane console. Fills carry a Cleanverse Travel Rule reference per leg, refusals a PII-free record. A differential test asserts no pair the matcher forms is refused on-chain.

THE DEMO: three panes, one asset, three Cleanverse CVI states, each with a depth ladder and rule strip showing the asset's RuleV2 plus venue lockup, cap and position; ineligible liquidity is absent, not greyed out. One sees full depth, one an empty book, one a verification link. Then a 99-holder cap binds and a better bid is passed over for a worse one - price-time priority violated by compliance, deliberately and lawfully: the cap is a disclosed asset term. Zero reverts.
```

### Cleanverse Integration Plan

```
CVI - the function that shapes the market, read at four points. At projection, the viewer's CVI tier, sub-tier, group and country are evaluated against each order's rule set: ineligible liquidity is absent, not greyed. At match and again at settlement both sides are re-verified. A watcher pulls orders when a maker's status or expiry ends eligibility.

CVA - both legs. The security is a Cleanverse CVA bound to CVI; the cash leg a Cleanverse CVA stablecoin under the same policy, so DvP moves both at once. Because a Cleanverse CVA can only be held by a valid Cleanverse CVI holder, the set who can legally settle is exactly the set the book was projected for: market shape and transferability, one constraint expressed twice.

CCP Protocol - matcher and contract call one function: canTransfer on the Cleanverse policy at 0xaC7e5179C2C7f03f209136886c172eb34F161792. The matcher eth_calls it at match formation, so refusals cost no gas; the contract calls it again in the settling transaction, so the matcher is never trusted and the book cannot offer a trade the chain refuses. Rules come from getRulesV2, OR-evaluated so a listing can carry several cohorts: RuleV2 gives group, sub-group, tier, sub-tier, country, while lockup, cap and position are venue-side state. A refusal moves no value and owes no Travel Rule data; fills carry a reference per leg.

Agent Skill Framework - settlement is a registered Cleanverse Agent Skill invoked under an EIP-191 operator mandate (nonce, expiry); it verifies its principal, then both parties against CVI.

API/SDK - a typed TypeScript client over the Cleanverse v3 API, with retry semantics separating transient sandbox from stable business errors and a short-TTL cache invalidated on status events.

Beyond the window: settlement is standard EVM against a policy already deployed on every integrated network, so an operator runs Venue as-is. Pilot: a transfer agent runs one asset's book for a quarter, replacing email and spreadsheets. Chain: Monad.
```

### Team Background

```
Solo builder, Monad-native since early testnet (devnad, VDP). I build monscope.xyz, production analytics on live Monad chain data. For June's Cleanverse hackathon I shipped cx402: compliance-gated agent payments on Cleanverse primitives, real aUSDC settlement on Monad testnet, EIP-191 signed mandates, PII-free receipts, Cleanverse Travel Rule reports. ~3,200 lines, 48 tests live against Monad. github.com/brutaldevvin/cx402 - Venue reuses its client, mandate and attestation layers.
```

### Business Plan / Deck
Skip. Pilot story lives in the Integration Plan as plain text.

---

---

## Build

Superseded by [`BUILD-VENUE.md`](BUILD-VENUE.md), which is self-contained and current. Everything
that was in this file's sections 2-5 predated the CCP integration guide, the deployed compliance
policy, and the Validator Compliance chain findings, and is no longer accurate.
