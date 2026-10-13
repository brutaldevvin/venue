# Venue

The compliant secondary market for tokenised real-world assets. **Eligibility shapes the
order book instead of gating the transfer.**

Every other compliant-RWA design lets anyone place an order and reverts the transfer at the
end. Venue projects the book per viewer against their live Cleanverse Verified Identity,
runs the compliance check at match formation rather than at settlement, and settles
delivery-versus-payment with both legs in Cleanverse Verified Assets. An ineligible pair is
never formed, so nothing reverts, no gas is burned on refusals, and no failed settlement is
created.

## Run it

```bash
pnpm install
pnpm test                                   # projection property tests
(cd contracts && forge test)                # contracts

pnpm tsx scripts/deploy.ts                  # deploy to Monad testnet
pnpm tsx scripts/seed.ts                    # credentials, balances, approvals
pnpm --filter @venue/console dev            # console on :3000
```

`.env` carries the keys and addresses; `scripts/deploy.ts` writes the deployed addresses
back into it. Note that `CHAIN=monad` in `.env` is read by `cast` as `--chain` and rejected
— unset it before any `cast` call.

Foundry's `forge` may be shadowed on PATH; this repo's contracts need `~/.foundry/bin/forge`.

## Layout

```
apps/console          three-pane console, venue service and REST API
packages/core         projection, rule evaluation, matcher + property tests
packages/cleanverse   typed Cleanverse v3 client, credential resolution
contracts/            Foundry: IATokenPolicy, MockPolicy, Listed, Settlement
scripts/              deploy, seed, API probes
```

## The demo

Three panes, one asset, three credential states. Viewer A sees full depth; viewer B is below
the asset's sub-tier and sees an empty book; viewer C has no credential and gets a
verification link. **Ineligible liquidity is absent, not greyed out** — greying it leaks the
book.

Then two bids cross. The better-priced one comes from a party who holds nothing, and the
holder cap is full, so the matcher passes it over for a worse bid from an existing holder —
price-time priority violated by compliance, deliberately and lawfully, with the governing
rule named in the tape. A fill settles both legs in one transaction. A resting maker's
credential lapses and their order leaves every projection.

Nothing in this reverts. That is the point.

See [`EVIDENCE.md`](EVIDENCE.md) for deployed addresses, transaction hashes and test counts,
and [`BUILD-VENUE.md`](BUILD-VENUE.md) for the decisions and their reasons.

## Design notes

- **Settlement is non-custodial** (D1). The contract is never `from` or `to` on either leg,
  which sidesteps needing its own CVI registered through the Validator Compliance module —
  the one not configured on Monad.
- **The holder cap lives in `Listed.sol`**, not the matcher (D2). `RuleV2` has no cap field,
  so `canTransfer` will never refuse for a cap breach; enforce it only off-chain and it is
  not enforced at all.
- **`canTransfer` reverts rather than returning false**, with bare `0x` and no reason string.
  Every call site wraps it in try/catch (D4), and `MockPolicy.strictMode` exists so the
  tests exercise that path rather than assuming it.
- **Orders are signed by the maker** (EIP-712), so the operator can hide an order but cannot
  fabricate one. That is what completes the trust boundary.
