# Venue

Venue is a compliant secondary market for tokenised real-world assets. Cleanverse Verified Identity shapes the order book before a trade is formed, and Cleanverse Verified Assets settle both legs atomically on Monad.

## Links

- Live demo: https://venue-rwa.fly.dev/
- One-page summary: [ONE-PAGE-SUMMARY.md](ONE-PAGE-SUMMARY.md)
- Submission copy: [submission/one-page-summary.md](submission/one-page-summary.md)
- Demo guide: [JUDGES.md](JUDGES.md)
- Captured evidence run: [EVIDENCE-RUN.md](EVIDENCE-RUN.md)
- Health proof: https://venue-rwa.fly.dev/api/health
- Raw projected books: https://venue-rwa.fly.dev/api/state
- Settlement ledger: https://venue-rwa.fly.dev/api/ledger
- Machine-readable brief: https://venue-rwa.fly.dev/llms.txt

## What it does

Venue makes eligibility part of market structure instead of a post-trade transfer check. The same asset renders differently for each viewer because the order book is projected against live Cleanverse Verified Identity data.

- Eligible viewer: sees executable liquidity.
- Credentialed but lower-tier viewer: sees an empty book with the governing constraint.
- Unverified viewer: sees a verification path from the registry.

The matcher checks compliance before forming a pair. Settlement re-verifies on-chain and moves security plus cash in one delivery-versus-payment transaction.

## Cleanverse integration

- **CVI:** A-Passes issued through `generate_apass`, read through `query_apass`, verification path from `verify_apass`, lapse through `update_status`, and a watcher that pulls orders when a maker's credential is no longer live.
- **CVA:** Cleanverse aUSDC is the cash leg, and the security is a registered Cleanverse asset. Both legs settle atomically through the settlement contract.
- **CCP / RuleV2:** Venue decodes the full six-field `RuleV2` shape and gates against an `IATokenPolicy`-compatible policy instance whose sub-tiers mirror live CVI.
- **API/SDK:** The console and capture scripts use the Cleanverse API for identity issuance, reads, verification links, status updates, and live evidence capture.

## Live deployment

- Chain: Monad testnet, chainId `10143`
- Security CVA: `0x3b4ef029bef7750f6f8ce81986e51f539ac389de`
- Cash CVA: `0xaC0893567D43C3E7e6e35a72803df05416C1f20D`
- Settlement: `0xea5e891232850b6d3b8822e9883ae81586351f4c`
- Policy instance: `0x2c6e4819cf4bb4a355f5b29903cff44053e5ebff`
- Cleanverse validator: `0xaC7e5179C2C7f03f209136886c172eb34F161792`

## Demo path

1. Open https://venue-rwa.fly.dev/.
2. Compare the three viewer panes before clicking anything.
3. Press **two bids cross** to see the holder cap bind and a fill settle.
4. Press **a credential lapses** to freeze a maker's A-Pass and watch their orders disappear.
5. Press **reset** to restore the registry and book for another run.

## Verification

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @venue/console build
pnpm test
pnpm contracts:test
```

The test suite includes property tests, watcher tests, Cleanverse mandate tests, a differential matcher test against deployed contracts, and 23 Foundry contract tests.

For live verification, use:

```bash
curl https://venue-rwa.fly.dev/api/health
curl https://venue-rwa.fly.dev/api/state
curl https://venue-rwa.fly.dev/api/ledger
```

## Local development

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm --filter @venue/console dev
```

The live deployment uses Fly. Runtime secrets are not committed.

## Repository map

- `apps/console` - Next.js console and live API routes
- `packages/core` - rule evaluation, projection, matcher, watcher logic
- `packages/cleanverse` - Cleanverse API client, credential helpers, mandate signing
- `contracts` - Solidity security token, policy mock, and DvP settlement contracts
- `scripts` - deployment, seeding, capture, registration, and probe scripts
- `submission` - hackathon submission text artifacts
