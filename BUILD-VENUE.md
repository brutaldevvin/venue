# Venue — build guide

Self-contained. Everything needed to build Venue from a cold start is in this file; no other
document is required, and nothing here is superseded elsewhere.

**Window:** Aug 8 00:00 - Aug 9 23:59 UTC. **Chain:** Monad testnet (chainId 10143).


## How to use this document

**Inputs to give the build session, in this order:**

1. This file.
2. `Cleanverse Compliance Protocol (CCP) CVA Integration Guide.pdf` - the contract templates and
   the Register CVA flow are in it; section 4 here transcribes only the interface.
3. The cx402 repo, cloned into the workspace (see section 9 for what to lift).
4. Your `.env`, extended per section 9.
5. The Cleanverse v3 docs, which unlock after registration.

**Kickoff prompt:**

> Read BUILD-VENUE.md end to end before writing anything. Then work section 8 - the hour 0-2 gate -
> and report what each of the five questions resolved to before touching contracts. After that,
> follow the hour plan in section 11. The definitions of done in section 10 tell you when to stop
> polishing a component; obey them. Every address is a constructor argument or an env var - never a
> constant. When a decision in section 5 conflicts with something you would otherwise do, the
> decision wins, and its stated reason tells you when it stops applying.

Replace the filename for Surety.

**Before hour 0:** register (keys arrive on registration), confirm all three demo wallets hold MON
on Monad testnet, and re-run the verification commands in section 2 - that table was captured on
Aug 6 and the sandbox changed twice that day.

---

## 0. What Venue is

A compliant secondary market for tokenised real-world assets. The thesis in one line: **eligibility
shapes the order book instead of gating the transfer.**

Every other compliant-RWA design lets anyone place an order and reverts the transfer at the end.
Venue projects the book per viewer against their live Cleanverse Verified Identity, runs the
compliance check at match formation rather than settlement, and settles delivery-versus-payment
with both legs in Cleanverse Verified Assets. An ineligible pair is never formed, so nothing
reverts, no gas is burned on refusals, and no failed settlement is created.

The signature case: an asset with a 99-holder cap and 99 holders must pass over a better-priced bid
from a new investor in favour of a worse bid from an existing holder. Price-time priority violated
by compliance, deliberately and lawfully, with the governing rule on screen.

### The demo to build toward

Three panes side by side, one asset, three credential states.

1. Pane A (permitted) sees full depth. Pane B (out of jurisdiction / below tier) sees an empty
   book. Pane C (unverified) sees nothing plus a verification link.
2. A fill settles delivery-versus-payment on Monad, both legs in CVA.
3. The 99th holder fills. The next bid - at a better price - is visibly passed over for a worse one
   from an existing holder, with the rule cited in the tape.
4. A resting maker's credential lapses and their order vanishes from the book.

Nothing in this demo reverts. That is the point.

---

## 1. What was promised

These three fields are frozen and already submitted. The build exists to make them true, and the
final submission text is reconciled against what actually shipped (section 10). Character limits
are hard: **2000 / 2000 / 500**, counted in characters, ASCII only.

<details>
<summary><b>Project Description</b> — 1993 chars</summary>

```
Venue is the compliant secondary market for real-world assets: an order book where Cleanverse Verified Identity (CVI) sets the liquidity you can see, and Cleanverse Verified Assets (CVA) settle both legs.

CLEANVERSE CAPABILITIES USED: CVI, CVA, CCP Protocol, API/SDK, Agent Skill Framework. Chain: Monad.

THE PROBLEM: Tokenizing a real-world asset is solved. Selling one is not. Private credit and fund shares sit untradeable - a trade needs a counterparty whose eligibility you can verify, and no venue can. Venues let anyone order, then revert at the end: a reverted transfer is a break, a failed settlement a fine.

THE SOLUTION: Venue makes eligibility a property of market microstructure, not a post-hoc check. The rule set shapes the book instead of gating the transfer. The book is projected per viewer against the live Cleanverse CVI registry; the matcher eth_calls the policy's canTransfer at match formation, so ineligible pairs never form and refusals cost no gas. Settlement calls it again on-chain: an operator can hide liquidity but never cause a bad trade.

WHAT WE BUILD: an eligibility-projected order book, a holder-cap-aware Cleanverse CCP matcher, an atomic delivery-versus-payment contract settling both legs in Cleanverse CVA, a watcher cancelling orders on CVI lapse, a settlement agent under EIP-191 mandate, a three-pane console. Fills carry a Cleanverse Travel Rule reference per leg, refusals a PII-free record. A differential test asserts no pair the matcher forms is refused on-chain.

THE DEMO: three panes, one asset, three Cleanverse CVI states, each with a depth ladder and rule strip showing the asset's RuleV2 plus venue lockup, cap and position; ineligible liquidity is absent, not greyed out. One sees full depth, one an empty book, one a verification link. Then a 99-holder cap binds and a better bid is passed over for a worse one - price-time priority violated by compliance, deliberately and lawfully: the cap is a disclosed asset term. Zero reverts.
```
</details>

<details>
<summary><b>Cleanverse Integration Plan</b> — 1997 chars</summary>

```
CVI - the function that shapes the market, read at four points. At projection, the viewer's CVI tier, sub-tier, group and country are evaluated against each order's rule set: ineligible liquidity is absent, not greyed. At match and again at settlement both sides are re-verified. A watcher pulls orders when a maker's status or expiry ends eligibility.

CVA - both legs. The security is a Cleanverse CVA bound to CVI; the cash leg a Cleanverse CVA stablecoin under the same policy, so DvP moves both at once. Because a Cleanverse CVA can only be held by a valid Cleanverse CVI holder, the set who can legally settle is exactly the set the book was projected for: market shape and transferability, one constraint expressed twice.

CCP Protocol - matcher and contract call one function: canTransfer on the Cleanverse policy at 0xaC7e5179C2C7f03f209136886c172eb34F161792. The matcher eth_calls it at match formation, so refusals cost no gas; the contract calls it again in the settling transaction, so the matcher is never trusted and the book cannot offer a trade the chain refuses. Rules come from getRulesV2, OR-evaluated so a listing can carry several cohorts: RuleV2 gives group, sub-group, tier, sub-tier, country, while lockup, cap and position are venue-side state. A refusal moves no value and owes no Travel Rule data; fills carry a reference per leg.

Agent Skill Framework - settlement is a registered Cleanverse Agent Skill invoked under an EIP-191 operator mandate (nonce, expiry); it verifies its principal, then both parties against CVI.

API/SDK - a typed TypeScript client over the Cleanverse v3 API, with retry semantics separating transient sandbox from stable business errors and a short-TTL cache invalidated on status events.

Beyond the window: settlement is standard EVM against a policy already deployed on every integrated network, so an operator runs Venue as-is. Pilot: a transfer agent runs one asset's book for a quarter, replacing email and spreadsheets. Chain: Monad.
```
</details>

<details>
<summary><b>Team Background</b> — 485 chars</summary>

```
Solo builder, Monad-native since early testnet (devnad, VDP). I build monscope.xyz, production analytics on live Monad chain data. For June's Cleanverse hackathon I shipped cx402: compliance-gated agent payments on Cleanverse primitives, real aUSDC settlement on Monad testnet, EIP-191 signed mandates, PII-free receipts, Cleanverse Travel Rule reports. ~3,200 lines, 48 tests live against Monad. github.com/brutaldevvin/cx402 - Venue reuses its client, mandate and attestation layers.
```
</details>

---

## 2. Verified environment

All of the following was confirmed by direct RPC calls on **Aug 6, 2026**. Re-verify before
building — this is a live sandbox and it changed twice in one day.

**Chain:** Monad testnet, `chainId 10143`, RPC `https://testnet-rpc.monad.xyz`

**CCP compliance policy:** `0xaC7e5179C2C7f03f209136886c172eb34F161792`

| Chain | Policy deployed |
|---|---|
| Monad testnet | yes (247-byte ERC-1967 proxy) |
| Base Sepolia | yes |
| Base mainnet | no |

**Live registered CVAs on Monad testnet** (someone else's, useful as reference):

| Address | Symbol | RuleV2 `(group, subGroup, minTier, minSubTier, countries)` |
|---|---|---|
| `0x38d55e73a3ddd8086e9592f41ad2ce27dcae3385` | RVS "ReVault Reg S T-Bill" | `(0x0000, 0x0000, 0, 70, 0)` |
| `0xc8a19b008cc1072015e04d9c4a26f0eed8a6429b` | RVD | `(0x0000, 0x0000, 0, 25, 0)` |

Note both use **`minSubTier`**, not `minTier`. Follow that convention unless the API says otherwise.

**From cx402** (`~/Desktop/cx402-secure.env`) — live on Monad testnet but **not registered** under
this policy, so `getRulesV2` returns `[]` for all three:

- aUSDC `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` (symbol confirmed, usable as plain ERC-20)
- A-Pass `0xbA82D189540CaC9DC6FF46B6837CaC1BFdEC58B9`
- settlement asset `0xcd94fa2bb8743b4a8c8cd625bdaf705fe80a4f29`

**Re-verify with:**

```bash
P=0xaC7e5179C2C7f03f209136886c172eb34F161792
R=https://testnet-rpc.monad.xyz
cast call $P "getRulesV2(address)((bytes2,bytes2,uint8,uint8,uint256)[])" \
  0x38d55e73a3ddd8086e9592f41ad2ce27dcae3385 --rpc-url $R
```

Policy event topics (for the watcher / indexer):
`0x26f4b31b7240e7422a9fe2ba5ce7684500302a536166d0ed481d7ad653ff25ab` (two indexed addresses) and
`0xb7cc3c365a7dadeaffc54d94652c8debb70d977b178e0291fbfe350f952f94ca` (one indexed address +
RuleV2 in data). `eth_getLogs` on Monad is capped at a **100-block range**.

---

### Cleanverse API — verified Aug 7, unauthenticated

Bases (from `cx402-secure.env`):

```
COOPERATE = https://uatapi.cleanverse.com/api/cooperate
SKILLS    = https://uatapi.cleanverse.com/api/skills
```

| Route | Method | Status | Note |
|---|---|---|---|
| `SKILLS/query_apass` | POST | **works, no auth** | credential lookup |
| `COOPERATE/atoken/register_atoken` | POST | exists (400 on empty body) | Method B registration |
| `COOPERATE/atoken/launch` | POST | exists (400 on empty body) | Method A issuance |
| `SKILLS/query_deposit_address` | POST | exists (500 on empty body) | Gateway, unused here |
| `*/apass/*`, `generate_apass`, `verify_apass`, `update_status` | — | 404 | do not exist at these paths |

Skills routes are **flat** — `SKILLS/query_apass`, not `SKILLS/apass/query_apass`.

**Credential lookup — the one that matters:**

```bash
curl -X POST https://uatapi.cleanverse.com/api/skills/query_apass \
  -H "Content-Type: application/json" \
  -d '{"address":"0x03681955065AF6EA51660dd63e7634fd0dE4d0a8","chain":"monad"}'
```

```json
{"code":"0000","message":"success","data":{
  "tier":"20","subTier":9,"group":"","subGroup":"CD","countries":[],
  "status":1,"expirationTime":1863690034,
  "currentKycHash":"0x0f1e...","cvRecordId":null}}
```

The field is **`address`**, not `walletAddress`. Missing credential returns
`code CN_001`, `"apass not found for user 0x..."` — treat as unverified, not as an error.

**These fields map one-to-one onto `RuleV2`:**

| query_apass | RuleV2 | note |
|---|---|---|
| `group` | `allowedGroup` | `bytes2`, empty string = unset |
| `subGroup` | `allowedSubGroup` | `"CD"` |
| `tier` (string!) | `minTier` | parse to int |
| `subTier` (int) | `minSubTier` | |
| `countries` | `poolCountryBitmap` | ISO list vs 256-bit mask |
| `status` | — | 1 = active |
| `expirationTime` | — | epoch seconds |

So `matches(credential, rule)` is implementable and testable **today, without keys**.

### Demo wallets — already credentialed

| Wallet | tier | subTier | subGroup | status | expiry |
|---|---|---|---|---|---|
| `W_PKEY` `0x0368…d0a8` | 20 | 9 | CD | 1 | 2029-01-21 |
| `W2_PKEY` `0xBe58…CfBB` | 20 | 9 | CD | 1 | 2029-01-21 |
| `FACILITATOR` `0x9c27…41Ce` | — | — | — | **none** | `apass not found` |

**No credential issuance is required.** `W_PKEY` and `W2_PKEY` are identical, so the contrast in
the demo must come from **the asset's rule set**, not from the wallets:

- **eligible pane** — `W_PKEY`, asset rule `minSubTier <= 9`
- **ineligible pane** — same or another credentialed wallet, against a rule demanding
  `minSubTier >= 25`
- **unverified pane** — `FACILITATOR`, no A-Pass, gets the verification path

This also explains the reverts: RVS demands `minSubTier 70` and RVD demands 25; your wallets have
9. The policy expresses "ineligible" as a **revert**, not `false`, which is exactly why every
`canTransfer` call needs the try/catch in D4.

---

## 3. What works where

Three separate surfaces. The Telegram thread conflates them; don't.

| Surface | Endpoints / contract | Monad | Base |
|---|---|---|---|
| CCP compliance policy | `canTransfer`, `getRulesV2` | works | works |
| CVA issuance | Register CVA / atoken launch | works | works |
| Validator Compliance | `/validator/grant`, `/validator/register`, `registerApass` | **broken** | works |

Venue needs the first two only — **provided settlement never holds CVA**. See decision D1.

---

## 4. The interface

From the integration guide. Within a rule the fields are **AND**; across `RuleV2[]` the rules are
**OR** — a holder is eligible if they satisfy any one rule. `0` / `0x0000` means unrestricted.

```solidity
interface IComplianceRule {
    struct RuleV2 {
        bytes2  allowedGroup;      // 0x0000 = unrestricted
        bytes2  allowedSubGroup;   // 0x0000 = unrestricted
        uint8   minTier;           // 0 = unrestricted, range 0-99
        uint8   minSubTier;        // 0 = unrestricted, range 0-99
        uint256 poolCountryBitmap; // 0 = unrestricted; ISO 3166-1 numeric bit positions, AND check
    }
}

interface IATokenPolicy is IComplianceRule {
    error TransferNotAllowed();
    function canTransfer(address token, address from, address to, uint256 amount)
        external view returns (bool);
    function setRuleV2(address token, RuleV2 calldata rule) external;
    function addRuleV2(address token, RuleV2 calldata rule) external;
    function removeRuleV2(address token, uint256 index) external;
    function setRuleV2FromToken(RuleV2 calldata rule) external;
    function addRuleV2FromToken(RuleV2 calldata rule) external;
    function removeRuleV2FromToken(uint256 index) external;
    function getRulesV2(address token) external view returns (RuleV2[] memory);
}
```

**`canTransfer` reverts — it does not return `false`.** Verified in every case tried: unregistered
token, registered token with random EOAs, registered token with its own registering owner. Bare
`0x` revert data, no reason string. This is the single most important behavioural fact here.

---

## 5. Decisions, with reasons

**D1 — Settlement is non-custodial.** Two `transferFrom` calls in one transaction; the contract is
never `from` or `to` on either leg.

> *Why:* Cleanverse confirmed that a contract holding CVA needs its own CVI registered via
> `registerApass`, which lives in the Validator Compliance module — the one that is not configured
> on Monad. Escrow would force a chain move to Base. Non-custodial sidesteps it entirely, and is a
> better design anyway: no custody risk, no escrow accounting, fewer lines.

**D2 — Holder cap lives in `Listed.sol`, not the matcher.**

> *Why:* `RuleV2` has no cap field, so `canTransfer` will never refuse for a cap breach. Enforce it
> only in the matcher and it isn't enforced at all — anyone can transfer outside Venue and blow
> through it.

**D3 — Build against `MockPolicy`, deploy against the real one.** `Listed.sol` takes the policy
address as a constructor argument.

> *Why:* Registration works but has a review step you don't control, and the property test wants
> adversarial rule sets you author. One constructor parameter switches between them.

**D4 — Wrap every `canTransfer` in try/catch.** See §5. A bare `0x` revert with no reason will cost
an hour of debugging otherwise.

**D5 — Eligibility is two layers.** `RuleV2` gates the **listing** (one boolean per viewer/asset,
since rules live on the token); lockup, holder cap and position limit are **venue-side** and gate
individual orders. This is also the answer to "projection is O(viewers × orders)" — it isn't.

**D6 — `eth_call` for match decisions, local predicate for rendering only.** Never reimplement the
policy as the source of truth.

**D7 — Allowances are the funding check.** A resting order is backed by an ERC-20 approval to the
settlement contract, so `allowance(maker, settlement) >= qty` validates it cheaply on-chain.

---

## 6. Contracts

### `MockPolicy.sol` — build-time stand-in

Implement `IATokenPolicy` with an internal `mapping(address => RuleV2[])`, OR semantics across the
array, and a settable per-address credential `(group, subGroup, tier, subTier, countryCode)`.
Return `false` where the real one reverts, **plus** a `strictMode` flag that reverts instead — so
tests can exercise both behaviours.

### `Listed.sol` — the CVA security

Based on the guide's `PartnerCompliantERC20V2` (OpenZeppelin v5, upgradeable or not).

```solidity
uint256 public holderCount;
uint256 public immutable maxHolders;
IATokenPolicy public immutable policy;

function _update(address from, address to, uint256 amount) internal override {
    // D4: canTransfer reverts rather than returning false
    try policy.canTransfer(address(this), from, to, amount) returns (bool ok) {
        if (!ok) revert IATokenPolicy.TransferNotAllowed();
    } catch {
        revert IATokenPolicy.TransferNotAllowed();
    }

    // D2: RuleV2 cannot express a holder cap, so enforce it here
    bool newHolder = to != address(0) && balanceOf(to) == 0 && amount > 0;
    if (newHolder && holderCount >= maxHolders) revert HolderCapExceeded();

    super._update(from, to, amount);

    if (newHolder) holderCount++;
    if (from != address(0) && balanceOf(from) == 0) holderCount--;
}
```

`holderCount` must be in the core contract from hour 8. Retrofitting it later costs the signature
demo beat.

### `Settlement.sol` — atomic DvP, no custody

```solidity
function settle(Match calldata m) external onlyAgent {
    security.transferFrom(m.seller, m.buyer, m.qty);      // each leg's _update
    cash.transferFrom(m.buyer, m.seller, m.notional);     // calls canTransfer itself
}
```

Both legs are CVAs, so each token's `_update` re-verifies its own counterparties. The settlement
contract needs no explicit `canTransfer` call — that check is free and automatic. Keep the
function small; the atomicity is the whole product.

---

## 7. Off-chain

### `project(book, viewer, rules)` — the thesis, as a pure function

```ts
matches(v: Credential, r: RuleV2): boolean =
  (r.allowedGroup    === ZERO || v.group    === r.allowedGroup)    &&
  (r.allowedSubGroup === ZERO || v.subGroup === r.allowedSubGroup) &&
  (r.minTier    === 0 || v.tier    >= r.minTier)                   &&
  (r.minSubTier === 0 || v.subTier >= r.minSubTier)                &&
  (r.countryBitmap === 0n || ((1n << BigInt(v.countryCode)) & r.countryBitmap) !== 0n)

eligible(viewer, asset) = rules[asset].some(r => matches(viewer, r))   // OR across the array
```

Pure and synchronous over an already-resolved credential. Fetch and cache outside; never inside.
That is what makes the property test possible.

### Property tests — the deliverable

Two invariants, both over randomised rule sets × credential states × books:

1. **No matched pair violates the rule set.** (The one named in the submission text.)
2. **The local predicate never hides an order that `canTransfer` would allow.** (Protects the
   claim the trust boundary rests on — that an operator cannot quietly hide liquidity. This is the
   one more likely to catch a real bug.)

Report the case count in the final submission text.

### Matcher

Price-time priority, modified by eligibility and venue limits. Holder-slot reservation:

```
available = maxHolders - onChainHolderCount - pendingNewHolderMatches
```

Reserve on match formation, release on settlement failure or timeout. Advisory only — `Listed.sol`
is authoritative (D2). Wrap the `eth_call` to `canTransfer` in try/catch; revert means ineligible
(D4).

### Watcher

Subscribe to CVI status/expiry via the API and cancel resting orders on lapse. Note that a lapsed
maker's order would fail at settlement anyway — the watcher stops it reaching that point.

### Console

Three panes, one asset, three credential states. Each pane: depth ladder, order ticket, and a rule
strip resolving that viewer's credential against the asset's RuleV2 plus venue lockup, cap and
position. Ineligible liquidity is **absent, not greyed**. When the matcher passes over a bid, the
holder-cap row turns and the skipped order is annotated in the tape with the constraint that
skipped it.

**The verification link comes from the CVI API, not the contract.** `canTransfer` reverts
identically for "no credential" and "tier too low", so the contract cannot tell you which. Only the
API can, and the "why" is what turns a dead end into onboarding.

---


## 8. Hour 0-2: resolve before writing code

Three of the original five questions are **answered** (see section 2): the credential endpoint, the
credential values for your demo wallets, and why `canTransfer` reverts. Two remain.

| # | Question | How to test | If the answer is bad |
|---|---|---|---|
| 1 | **Register CVA latency on Monad.** How long from `register_atoken` to rules being settable? | Submit one the moment keys land. | Build against `MockPolicy` for the whole window and swap the policy address if it activates. |
| 2 | **The v3 request scheme.** The guide specifies AES/CBC/PKCS5Padding on `data`, base64 body, `api-id` and `X-Request-ID` headers - confirm field names against the live docs. | Diff cx402's client against docs.cleanverse.com once registered. | Lift cx402's signing verbatim and adjust field names until a known-good call returns `code 0000`. |

Note `query_apass` needed **no** encryption or headers, so the AES scheme may apply only to
`cooperate/*`. Establish that before wrapping every call in it.

Re-run the verification commands in section 2 at the same time. That table was captured on Aug 6-7
and the sandbox changed twice in a day.

---

## 9. Stack and scaffold

Fixed decisions - do not spend window time relitigating them.

```
pnpm workspace
apps/console          Next.js 14 app router, tailwind, wagmi + viem
packages/cleanverse   typed v3 client            [LIFT from cx402]
packages/core         domain logic + property tests (vitest + fast-check)
contracts/            Foundry (forge)
scripts/              deploy, seed, capture
```

- **Foundry, not Hardhat.** Competitors are naming Foundry invariants and it is the right tool for
  the property tests both projects depend on.
- **viem, not ethers.** The `cast` probes in §2 map directly onto viem's `readContract`.
- **vitest + fast-check** for the off-chain property tests.
- Contracts take every address as a constructor argument. No constants (D8 in Surety; same rule
  applies to Venue).

### What to lift from cx402

Clone it into the workspace and take, in order of value:

1. **The request layer** - AES/CBC encryption of `data`, base64 body, `api-id` and `X-Request-ID`
   headers, and the retry semantics that separate transient sandbox errors from stable business
   errors. This is the single most valuable thing in that repo and rewriting it costs hours.
2. **EIP-191 mandate signing and verification** - nonce and expiry bound. Lifts almost unchanged.
3. **Signed PII-free attestation/receipt generation.**
4. **The deploy and test pipeline.**

Do not lift the payment-flow logic; neither project needs it.

### Environment

Reuse the names already in `~/Desktop/cx402-secure.env` so nothing has to be reconciled:

```
CLEANVERSE_APP_ID, CLEANVERSE_APP_KEY          # API credentials
CLEANVERSE_COOPERATE_BASE, CLEANVERSE_SKILLS_BASE
MONAD_RPC_URL, CHAIN_ID=10143, NETWORK=eip155:10143
W_PKEY, W2_PKEY, FACILITATOR_PKEY              # demo wallets + operator
POLICY_ADDRESS=0xaC7e5179C2C7f03f209136886c172eb34F161792
```

Add project-specific addresses as they are deployed. Never hardcode an address in a contract or a
component - read it from env or a constructor argument.

---

## 10. Venue specifics

### Order model
Orders are **off-chain, signed by the maker**, held by the venue, and settled on-chain. Signing
matters: it means the operator can hide an order but cannot fabricate one, which completes the
trust boundary the submission claims.

```ts
type Order = {
  id: string; asset: Address; maker: Address;
  side: 'bid' | 'ask'; price: bigint; qty: bigint;
  expiry: number; nonce: bigint; signature: Hex;   // EIP-712
}
```

REST only - no WebSocket. `GET /book/:asset` returns the projection for the caller's resolved
credential; `POST /orders` accepts a signed order; `GET /audit` backs the audit view. Polling at 1s
is sufficient for a demo and removes a whole class of bug.

An order is live only if `allowance(maker, settlement) >= qty` and the maker still passes
`canTransfer`. Check both when projecting; drop silently, do not error.

### Definition of done, per component
- `Listed.sol` - deploys, `holderCount` increments and decrements correctly across mint, transfer
  and burn-to-zero, cap breach reverts with a named error.
- `Settlement.sol` - one transaction moves both legs; the contract's balance is zero before and
  after; a revert on either leg reverts both.
- `project()` - both property tests green, case counts recorded.
- Matcher - the 99th-holder case passes over a better bid and logs the governing rule.
- Console - three panes render different books for three credentials from one asset.

Stop polishing a component the moment its line above is true.

## 11. Hour plan

| Hours | Work |
|---|---|
| 0–2 | Keys. Register CVA on Monad, start review clock. Smoke-test the API surface |
| 2–4 | Lift `packages/cleanverse` from cx402; add rules cache + credential resolution |
| 4–8 | `MockPolicy` + `Listed.sol` **with `holderCount`** + `Settlement.sol`. Deploy, test |
| 8–14 | `project()` + both property tests |
| 14–20 | Matcher: CCP `eth_call`, cap reservation, position limits, allowance check |
| 20–26 | Watcher; settlement agent under EIP-191 mandate (mostly lifted) |
| 26–36 | Three-pane console + audit view |
| 36–42 | Run the demo, capture every hash into `EVIDENCE.md` via `capture.ts` |
| 42–46 | README, CAPABILITIES.md, video |
| 46–48 | **Reconcile the submission text against what shipped.** Cut anything that didn't land |

Cut order under pressure: console polish → watcher → holder-cap matcher. **Never** the projection
function or its property tests.

---

## 12. Open questions

- **Register CVA review turnaround on Monad.** Two CVAs got through on Aug 6, so it works and is
  reasonably fast — but the exact latency is unknown. Ask in Telegram; register early.
- **Does `canTransfer` ever return a boolean?** Every case tried reverts, and section 2 explains
  why — your wallets are sub-tier 9 against assets demanding 25 and 70. Retest once your own asset
  carries a rule they satisfy. The try/catch is correct either way.
- **Is there a CVA stablecoin for the cash leg**, or do you issue one? aUSDC is live but not
  registered under this policy, so it would settle as a plain ERC-20.
- **Multiple wallets per person.** No resolution primitive exists in `RuleV2`, and `query_apass`
  returns no person identifier — `cvRecordId` came back `null`. Do not claim person-level holder
  caps.
- **Set your asset's `RuleV2` to fit the wallets you have**, not the other way round. `minSubTier`
  at or below 9 makes `W_PKEY` eligible; a second listing demanding 25 gives you the ineligible
  pane for free.

## 13. Capture for evidence, and reconciliation

Deployed `Listed.sol` address · `Settlement.sol` address · three projection screenshots of one
asset · DvP settlement tx hash · holder-cap refusal record · lapse-cancellation attestation ·
property test case counts (both invariants) · projection latency at N resting orders.

Write these to `EVIDENCE.md` **as they happen**. Retrofitting at hour 44 is how people end up with
a demo they cannot cite.

### Reconciliation at hour 46

The registration text is a plan; the final submission is not. Before submitting, go through the
three frozen fields in section 1 and cut or amend anything that did not ship. Specifically:

- If the demo ran against `MockPolicy` rather than `0xaC7e...1792`, say so plainly. Do not leave a
  live contract address in the text implying you called it.
- If the settlement agent was cut, remove **Agent Skill Framework** from `CLEANVERSE CAPABILITIES
  USED` and delete its paragraph from the Integration Plan. A claimed capability with no build
  behind it is the one failure that outlives the leaderboard.
- Replace future-tense build language with what exists: deployed addresses, tx hashes, property
  test case counts, line and test counts for Venue itself - not cx402's.
- Add the projection latency figure. It is the only number that answers the scaling question.

Same character limits apply: 2000 / 2000 / 500, ASCII only. Count before pasting.
