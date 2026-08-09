# Venue, for judges

**Eligibility shapes the order book instead of gating the transfer.**

A 90-second guide to what this is, what to click, and how to confirm none of it is staged.

Monad testnet, chainId 10143.

## 1. The problem

Tokenising a real-world asset is solved. Selling one is not. A trade needs a counterparty
whose eligibility you can verify, and no venue can, so private credit and fund shares sit
untradeable. Every compliant-RWA design lets anyone place an order and reverts the transfer
at the end. A reverted transfer is a settlement break; a failed settlement is a fine.

Venue runs the compliance check at **match formation** rather than at settlement, so an
ineligible pair is never formed. Nothing reverts, and refusals cost no gas.

## 2. What to click, about 90 seconds

1. Open the console. Three panes render **already different**, before you touch anything:

   - **[A]** sub-tier 75, sees full depth
   - **[B]** sub-tier 9 against a rule demanding 70, sees an empty book naming the constraint
   - **[C]** no A-Pass at all, sees a verification link

   Ineligible liquidity is **absent, not greyed**. Greying it would leak the book.

2. Press **1. two bids cross**. A better-priced bid from a party holding nothing is passed
   over for a worse bid from an existing holder, because the holder cap is full. The tape
   names the rule that skipped it, in coral. Price-time priority violated by compliance,
   deliberately and lawfully.

   The fill settles both legs in one transaction. Click the hash to open it.

3. Press **2. a credential lapses**. This freezes a maker's A-Pass **at the Cleanverse
   registry** through `update_status`. The watcher pulls their orders out of every book.

4. Press **reset** to put the registry and the book back. It is repeatable.

Nothing in this reverts. That is the point.

## 3. How to confirm it is live

**One URL checks every dependency at once:** `/api/health`

It reports the current Monad block, the registry read for all three identities with their
real tier and sub-tier, the holder count against the cap, the settlement agent's gas, and
that the cash leg is Cleanverse aUSDC. Nothing is cached and nothing is simulated.

`/api/state` returns the raw projection the console renders, so you can see that the three
books differ in the data and not just in the UI.

**The cash leg is Cleanverse aUSDC itself**, `0xaC0893567D43C3E7e6e35a72803df05416C1f20D`,
not a token we minted. It enforces CVI on transfer: sending it to a wallet with no A-Pass
reverts, which is why viewer C cannot receive it.

**The credentials are real A-Passes.** We issued them through `generate_apass` at chosen
sub-tiers and read them back through `query_apass`. Check any viewer address against the
registry yourself.

**A settled transaction**, both legs, one transaction, zero reverts:
`0x133d7ffd82299c45fe59b24b375e1b80c91ddfaa21c1f250e223dd44b9b2d498`

## 4. Two things we found in the deployed contracts

**`RuleV2` has six fields, not five.** The Cleanverse team confirmed the complete shape:
`allowedGroup`, `allowedSubGroup`, `minTier`, `minSubTier`, `isBlackList`, `countryBitmap`.
`isBlackList` inverts the country clause from an allow-list to a deny-list, and because it
sits before `countryBitmap`, a five-field decode corrupts country handling and misaligns
multi-rule decodes.

**`canTransfer` is not at `0xaC7e5179C2C7f03f209136886c172eb34F161792`.** Extracting all 98
selectors from that implementation shows `getRulesV2` present and `canTransfer` absent; that
address is the compliance validator, and a live registered CVA confirms it by returning it
from `validator()`. We therefore implement the documented `IATokenPolicy` and gate against an
instance whose sub-tiers mirror live CVI, with the policy as a constructor argument so it
repoints with no code change.

## 5. For the test-minded

```bash
pnpm test                      # 26 tests: property, unit, differential
cd contracts && forge test     # 23 contract tests
```

- **60,000 property cases** over two invariants, checked against a policy oracle written from
  the interface rather than from our implementation, so it is not the same code twice.
- **A differential test** runs the matcher against deployed contracts and settles every pair
  it forms. It found `orderLive` checking a maker's allowance but never their balance, which
  let the matcher form a pair that reverted at settlement.
- **A 256-run fuzz** asserts a transfer succeeds if and only if `canTransfer` allows it.
- Evidence is generated, not transcribed: `scripts/capture.ts` drives a live run and writes
  [`EVIDENCE-RUN.md`](EVIDENCE-RUN.md) with full hashes confirmed by receipt.

## 6. What we could not make true

Travel Rule references are wired per leg and the call path is proven: it returns a real PDF
for a transaction Cleanverse has indexed. Our own settlements return `TR_001`, because
Monad-side ingestion is not currently recording. `query_txs` returns zero for a wallet with
live transfers, and `ausdc` is rejected as an invalid symbol on Monad while accepted on Base.

We would rather say that plainly than quietly drop the claim.
