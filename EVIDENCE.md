# Venue — evidence

Written as things happen, per BUILD-VENUE §13. Everything below is a direct observation,
not a plan.

---

## Pre-window (Aug 7, 2026)

### Section 2 re-verified

All confirmed by live RPC against `https://testnet-rpc.monad.xyz` and the Alchemy endpoint
in `.env`.

| Fact | Value |
|---|---|
| chainId | `10143` |
| CCP policy | `0xaC7e5179C2C7f03f209136886c172eb34F161792`, 247-byte proxy |
| RVS `getRulesV2` | `[(0x0000, 0x0000, 0, 70, 0)]` |
| RVD `getRulesV2` | `[(0x0000, 0x0000, 0, 25, 0)]` |
| aUSDC / A-Pass / settlement asset | `[]` — not governed by this policy |
| `canTransfer` on RVS, W→W2 | reverts, `execution reverted, data: "0x"` |

Demo wallet credentials, from `skills/query_apass`:

| Wallet | tier | subTier | subGroup | status | MON |
|---|---|---|---|---|---|
| `W_PKEY` `0x0368…d0a8` | 20 | 9 | CD | 1 | 17.79 |
| `W2_PKEY` `0xBe58…CfBB` | 20 | 9 | CD | 1 | **0.00** |
| `FACILITATOR` `0x9c27…41Ce` | — | — | — | none (`CN_001`) | 19.43 |

**Open action:** `W2_PKEY` holds no MON and cannot approve or settle until funded.

### API findings that differ from BUILD-VENUE §2

1. **The June cx402 credentials still authenticate.** No registration wait was needed for
   any read, and both issuance routes are reachable.
2. **Encryption is per-endpoint, not global.** `skills/*` needs nothing; `cooperate/query_apass`
   and `cooperate/verify_apass` take a plain body with only `api-id`; `cooperate/atoken/*`
   requires the AES body. An unencrypted body to `atoken/*` returns HTTP 403
   `Forbidden.Data decryption failed.`, which reads like an auth failure and is not one.
   No `X-Request-ID` is required anywhere.
3. **`cooperate/verify_apass` exists** and returns `magickLink`
   (`https://test-magiclink.cleanverse.com/`). §2 recorded `verify_apass` as 404 — that was
   the *skills* base. This is the source for the console's `Get verified →`.
4. **`cooperate/query_apass` returns `cvRecordId: "371"`** where `skills/query_apass` returns
   `null` for the same wallet. A person identifier does exist, on the cooperate surface only.
5. **`verify_apass` reports `atoken not exist` for RVS**, which does have rules under the
   policy. The registry behind `verify_apass` is not the same set as the policy's
   `getRulesV2`; they must not be treated as one lookup.

### `atoken/launch` schema — discovered without submitting

Walked by omission: the API names one missing field at a time and rejects unknown fields,
so only fields it asked for were ever added, each filled with a junk placeholder.

Required fields, in the order the API demands them:

```
icon, token_symbol, decimals, rule, admin_address, chain, token_name
```

All **snake_case**. `rule` is a **single object** (`com.cleanverse.gateway.dto.ATokenRuleParam`),
not an array — an array returns `expect {, but [`. So `launch` sets one cohort and a second
requires an on-chain `addRuleV2`.

`rule` subfields confirmed by the same method:

```
allowed_group, allowed_sub_group, min_tier, min_sub_tier, countries
```

`countries` is the confirmed name (`pool_country_bitmap` and eight other guesses were all
rejected as unknown). Its **value format is unresolved** — every candidate returns the
generic `Invalid parameter`, which the deliberately-junk `icon` also produces. Settling it
requires a call that could succeed, which is hour 0's job.

Nothing was submitted. `scripts/hour0-register.ts` holds the payload and refuses to send
without `--submit`.

### Spec defect found: `poolCountryBitmap` cannot hold ISO 3166-1 numeric codes

BUILD-VENUE §4 and §7 both describe the field as "ISO 3166-1 numeric bit positions". ISO
numeric codes run to 894 and `1 << 840` does not fit a `uint256`. With ~249 assigned
countries the mask is exactly wide enough for a compact 0–255 ordinal, which is almost
certainly what it holds — and the `launch` API taking `countries` as a list while the
contract stores a bitmap supports that: the mapping happens inside Cleanverse.

Both live reference CVAs carry `poolCountryBitmap = 0`, so the chain does not disambiguate
it. Treated as an opaque 0–255 index; the resolver drops out-of-range values rather than
guessing a mapping. Every demo wallet has an empty country list, so nothing in the demo
depends on the resolution.

---

## Test results

### Off-chain property tests — `pnpm test`

| Invariant | Cases | Coverage |
|---|---|---|
| 1. No matched pair violates the rule set | 20,000 | 172 matched pairs |
| 2. Local predicate agrees with the policy (listing) | 20,000 | — |
| 2. Local predicate hides nothing allowed (order) | 20,000 | 372 allowed orders checked |

Plus the signature case as a worked example: with a 99-of-99 holder cap, a 120 bid from a
newcomer is passed over for a 110 bid from an existing holder, and the skip record names
the cap.

The oracle in `packages/core/test/oracle.ts` is written from the CCP interface rather than
from the implementation — it works in decimal, iterates the bitmap bit by bit, and shares
no helper with `src/rules.ts`.

**Two real bugs caught by these tests before any UI existed:**

1. `countryBitmap` threw on ISO numeric codes above 255 — the spec defect above.
2. `project()` dropped asks that overshot a partially-filled position limit without
   reporting the constraint. Liquidity vanished with nothing on the rule strip — exactly
   the "operator can quietly hide liquidity" hole invariant 2 exists to catch.

**Coverage note:** the first generator draw produced only **7** matched pairs in 20,000
cases — the invariants were passing almost vacuously. Biasing maker credentials toward the
drawn rule set and narrowing the price band to 95–105 raised it to 172. The earlier number
was not worth citing and is recorded here so the improvement is not mistaken for a fix.

### Contracts — `forge test`

19 tests, all passing.

`Listed.t.sol` (12): holderCount across mint, partial and full transfer, and burn-to-zero;
cap breach reverts `HolderCapExceeded`; cap-full still admits an existing holder; a freed
slot is reusable; ineligible and uncredentialed transfers revert; **`strictMode` proves the
try/catch turns a bare `0x` revert into the named error** (D4); and a 256-run fuzz asserting
a transfer succeeds if and only if `canTransfer` allows it.

`Settlement.t.sol` (7): both legs move in one transaction; **the contract's balance of both
assets is zero before and after** (D1); a revert on either leg reverts both; a holder-cap
breach at settlement reverts both, so a matcher that ignored the cap still could not push a
trade through; `onlyAgent`; and atomicity holds under `strictMode`.

---

## First working iteration — live on Monad testnet

Deployed against `MockPolicy` (D3), which is also what makes the promised demo possible:
credentials are settable, so the contrast is **one asset, three CVI states** rather than the
two-listing workaround the identical demo wallets would otherwise force.

| Contract | Address |
|---|---|
| `MockPolicy` | `0xc1d6fee9c86746d9346cdd875896db7df3b62e42` |
| `Listed` (security, RVS) | `0x3e4d167d6f8d14d998e9b34482be9ab22c1cb330` |
| `Listed` (cash, aUSDC) | `0x4b007a3fee4cbaf18e915a82bc39842c8338cb22` |
| `Settlement` | `0xf031a5edf0b953cd09d450f536092b68030ebcce` |

Asset rule set: `(0x0000, 0x0000, 0, 70, 0)` — sub-tier 70, mirroring the live RVS reference
CVA. Holder cap 5, and 5 holders exist, so the cap binds from the first block.

### All four demo beats, verified end to end

**1. Three books.** One asset, three credentials, three different projections on load:

```
[A] subTier=75   visible=6   full depth
[B] subTier=34   visible=0   subTier >= 70
[C] subTier=none visible=0   no verified identity + verify link
```

**2. The holder cap binds.** A 10300 bid from an eligible non-holder is passed over for a
10200 bid from an existing holder. Price-time priority violated by compliance, with the
governing rule in the tape: `holders < 5 (at 5)`.

**3. A credential lapses.** Clearing a resting maker's credential drops their orders from
every projection — viewer A's book went 6 → 4. Tx `0x3270c2a1a9c5…`

**4. A fill settles.** `100 @ 10150`, both legs in one transaction, non-custodial.
Tx `0x1ef54b122879…`

**Zero reverts across the whole run.** Refusals cost no gas, because no ineligible pair was
ever formed.

### Projection latency

**360–670 ms** for three viewers over a 6–8 order book, dominated by RPC round-trips rather
than by projection itself: the pure function runs once per viewer (D5), not once per
viewer × order. Worth re-measuring with multicall batching before citing as a scaling number.

### Two bugs the live run caught

1. **Next compiles each API route into its own module graph in dev**, so `/api/run` and
   `/api/state` each held a private copy of the book — the tape was written to one and read
   from the other, and silently never appeared. The store now lives on `globalThis`.
2. **The matcher recorded one skip per ask considered**, so a single cap breach reported
   three times. A venue-side refusal is a property of the bid, not of the ask it was tried
   against, so it is now recorded once.

---

## Still to capture

- Three projection screenshots of one asset
- Travel Rule reference per settled leg
- Lapse-cancellation attestation (the event is recorded; the signed attestation is not)
- Projection latency with multicall batching, at a larger book
