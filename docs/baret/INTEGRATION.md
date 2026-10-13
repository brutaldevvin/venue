# Baret integration and review

## Signing boundaries

Original source locations before this change:

| File and line | Operation |
| --- | --- |
| `apps/console/lib/venue.ts:409` | Agent calls `Settlement.settle` |
| `apps/console/lib/venue.ts:457` | Owner calls `MockPolicy.clearCredential` |
| `scripts/deploy.ts:35` | Contract deployment |
| `scripts/deploy.ts:84` | Policy configuration |
| `scripts/seed.ts:51` | Credentials, minting and owner approvals |
| `scripts/seed.ts:92` | Native MON funding |
| `scripts/seed.ts:133` | Maker approvals, with an explicit account override |
| `apps/console/lib/orders.ts:46` | Off-chain EIP-712 order signature, not an on-chain transaction |

`@venue/guard` wraps the local account's `signTransaction`. Viem invokes this after preparing/encoding the transaction and immediately before broadcasting the signed result. All transaction paths above use wrapped accounts, including the seed account override. Off-chain order signatures are unchanged; Baret is not being presented as an order-validity/compliance check.

The SDK is pinned to `@baret/guard@0.1.2`, installed using the project's pnpm 9.15.4 with lifecycle scripts disabled. It uses `balanced`, `testnet`, and the specified HTTPS endpoint. Actual sender, recipient (null for creation), wei value, calldata, gas, fees and nonce are evaluated. The account/private key is never passed to Baret.

- Safe: sign only with an unexpired, correctly networked verdict and no blocking finding.
- Blocked: throw before signing and display finding codes.
- Unreachable, invalid request/response, expired verdict, or unsupported chain: refuse signing.
- Caution in the console: show findings/values and the exact unsigned transaction; require explicit confirmation. A short-lived server-side token is bound to the action, transaction and findings and consumed once. The resumed action re-evaluates before signing; changed transaction fields or findings require new consent. Completed fills are removed from the book; resuming `cross` does not inject duplicate bids.
- Caution in CLI: show findings and transaction, require typing `yes`. Noninteractive execution refuses caution. If approval takes longer than the verdict lifetime, refuse and ask for a retry.

Confirmation storage and run serialization are process-local, matching Venue's existing in-memory book. Multiple server replicas would require shared storage/locking. A confirmation token is not authentication. The existing `/api/run` endpoint lacks authentication and controls server-held keys; this integration does not make that existing deployment pattern production-safe.

## Real calls and validation

Run `pnpm tsx scripts/check-baret.ts` from the repository root. This reads only public chain state and invokes Baret; it does not load private keys, sign, deploy, seed or broadcast. It overwrites the two evidence JSON files, including full requests and responses.

1. `blacklist.json`: the exact supplied 0.1 MON call returned `blocked`, `KNOWN_MALICIOUS_ADDRESS`, confidence `high`, traced `true`, request ID `d649f2a2-f27f-4c33-bce7-7d1a75ee717b`, at `2026-10-13T16:57:29.000Z`.
2. `venue-approval.json`: the existing seed approval, `approve(settlement, 2^255 - 1)`, against the RVS deployment documented in `EVIDENCE.md`. Sender was read from the contract's live `owner()` and RPC chain ID was checked as 10143. Returned `caution`, `ERC20_APPROVAL_GRANTED` and two `UNKNOWN_CONTRACT_EXPOSURE` findings, confidence `high`, traced `true`, request ID `49389cce-f7c0-4029-bd40-41f066004eb5`, at `2026-10-13T16:57:30.000Z`.

These are simulation results, not mined transactions. We did not exercise the funded UI against a live signer. Automated tests exercise a real Viem `writeContract` with a controlled RPC transport and verify refusal before both signing and raw-transaction broadcast. Other tests cover safe, caution acceptance/rejection, SDK malformed responses/status errors/timeouts, unsupported chain, expiration, contradictory findings, contract creation, and token binding/replay protection. Validation passed: `pnpm test` (26 tests, including the existing 60,000 randomized matcher/projection cases), `pnpm typecheck`, and `NEXT_TELEMETRY_DISABLED=1 pnpm --filter @venue/console build`. Existing matcher/property tests remain included.

## Safety review and limits

- Inspected the published SDK JavaScript, exports, schemas, metadata and runtime dependency. No install lifecycle scripts, private-key reads, filesystem/process execution or signing/broadcast functions were found in the SDK. Its network operation is the JSON POST to the configured `/v1/analyze` endpoint.
- Verified the downloaded SDK tarball's SHA-512 against the npm registry integrity value; the same integrity is pinned in the lockfile. This establishes artifact consistency, not author trust or a formal security audit. The registry metadata did not provide a provenance attestation for this SDK release.
- The SDK's sole runtime dependency is `zod@4.6.5`, which has no runtime dependencies or install lifecycle scripts. pnpm audit reported no advisories for Baret or Zod at review time.
- The full existing dependency tree has 49 advisory entries: 6 critical, 16 high, 23 moderate and 4 low. They concern existing dependencies such as Next.js, Vitest, Tinypool and Vite; no existing package versions were upgraded by this integration. Audit findings are not proof that each issue is exploitable here. They do mean this result should not be described as a security clearance for Venue. Unrelated dependency upgrades were kept outside this change.
- Transaction intentions (sender, recipient, amount, calldata and fee fields) are disclosed to Baret before signing. The service can observe this data, become unavailable, or return an incorrect schema-valid verdict. No independent audit of the hosted service, its deployment or data retention was performed. A `safe` response is not a guarantee against loss. Existing Venue matching/compliance logic is retained.

## Feedback for the Baret team

1. The basic README sample and published TypeScript API worked with no API key. The blacklist sample reproduced exactly. Live replies included usable request IDs, trace status, findings and source status.
2. **Large approval classification:** Venue approves `2^255 - 1` tokens. Baret reported `approvals[0].unlimited: false`, and Balanced allowed user confirmation (`caution`), despite `blockUnlimitedApprovals: true`. This is an effectively enormous allowance. Please document the detection threshold and consider treating near-maximum allowances as unlimited or explicitly warning about their scale. This is an observed limitation, not proof of an exploit.
3. **Network support ambiguity:** the supplied deployment instructions say testnet-only, while the published SDK exports/types also accept `mainnet` (143). Venue explicitly refuses chains other than 10143. SDK acceptance should not be interpreted as proof of hosted network support.
4. **Expiration is not enforced by the SDK:** `expiresAt` is typed/validated only as a string. The SDK does not check expiration or that `meta.chainId` matches the request. Venue adds those checks, including rechecking expiry after human confirmation. A documented helper would reduce integrator mistakes.
5. **`isSignable` is not user consent:** it returns true for caution. Integrators still need transaction-bound confirmation, fresh evaluation, and refusal on cancellation. A Viem/server-key example would be useful; a simple boolean guard sample does not cover this flow.
6. **Diagnostics:** non-2xx errors contain only `Baret answered <status>` and discard the body; schema errors use a generic message with validation details in `cause`. Request validation throws `ZodError`, not `GuardUnreachableError`. All must fail closed, but structured error codes/retry hints would make troubleshooting easier.
7. **Documentation packaging:** the npm README points to repository-relative paths such as `docs/ARCHITECTURE.md` and `packages/guard/src/findings.ts`; these files are not in the tarball. The exported declarations are usable, but direct versioned documentation links would help. The npm web page was unavailable to the browsing tool; the registry tarball/README was accessible.
8. **Multi-party visibility:** README says balance deltas protect the sender by default. Venue's settlement sender is an agent, while buyer and seller own the assets. This integration is a pre-sign transaction check, not evidence that every participant's losses were separately checked. An explicit multi-party settlement example would clarify this boundary.
9. Default SDK timeout is 15 seconds; the standalone verification script allows 45 seconds for the hosted endpoint. Production integration retains the SDK default and refuses on timeout; availability failures are never silently bypassed.
