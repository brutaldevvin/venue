import { NextResponse } from 'next/server'
import { CleanverseClient } from '@venue/cleanverse'
import { privateKeyToAccount } from 'viem/accounts'
import { addresses, listedAbi, policyAbi, publicClient } from '@/lib/chain'
import { clientKey, limiterState } from '@/lib/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * One URL that proves the whole thing is live.
 *
 * A judge should not have to take a screenshot on trust. This hits every dependency at
 * once - Monad RPC, the Cleanverse registry, the deployed contracts - and reports what each
 * one actually returned, so "it works" is checkable rather than asserted.
 *
 * Nothing here is cached and nothing is simulated. If a dependency is down, the field says
 * so instead of the endpoint failing.
 */
const AUSDC = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D'
const PUBLIC_BASE = 'https://venue-rwa.fly.dev'
const REPO = 'https://github.com/brutaldevvin/venue'

function client(): CleanverseClient {
  return new CleanverseClient({
    apiId: process.env.CLEANVERSE_APP_ID ?? '',
    appKey: process.env.CLEANVERSE_APP_KEY ?? '',
    cooperateBase:
      process.env.CLEANVERSE_COOPERATE_BASE ?? 'https://uatapi.cleanverse.com/api/cooperate',
    skillsBase: process.env.CLEANVERSE_SKILLS_BASE ?? 'https://uatapi.cleanverse.com/api/skills',
  })
}

function addressOf(envKey: string): string | null {
  const raw = process.env[envKey] ?? ''
  if (!raw) return null
  try {
    return privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`).address
  } catch {
    return null
  }
}

export async function GET(req: Request) {
  const chain = process.env.CHAIN ?? 'monad'
  const cv = client()

  const viewers = [
    { key: 'A', role: 'eligible', address: addressOf('VIEWER_A_PKEY') },
    { key: 'B', role: 'credentialed but below the rule', address: addressOf('W_PKEY') },
    { key: 'C', role: 'unverified', address: addressOf('FACILITATOR_PKEY') },
  ]

  const settled = await Promise.allSettled([
    publicClient.getBlockNumber(),
    publicClient.readContract({
      address: addresses.security,
      abi: listedAbi,
      functionName: 'holderCount',
    }),
    publicClient.readContract({
      address: addresses.security,
      abi: listedAbi,
      functionName: 'maxHolders',
    }),
    publicClient.readContract({
      address: addresses.policy,
      abi: policyAbi,
      functionName: 'getRulesV2',
      args: [addresses.security],
    }),
    publicClient.getBalance({ address: addressOf('FACILITATOR_PKEY') as `0x${string}` }),
    ...viewers.map((v) =>
      v.address ? cv.queryApass({ chain, address: v.address }) : Promise.resolve(null),
    ),
  ])

  const at = <T,>(i: number): T | null =>
    settled[i]?.status === 'fulfilled' ? ((settled[i] as PromiseFulfilledResult<T>).value) : null

  const block = at<bigint>(0)
  const holders = at<bigint>(1)
  const cap = at<bigint>(2)
  const rules = at<readonly { minSubTier: number | bigint }[]>(3)
  const agentGas = at<bigint>(4)
  const apass = viewers.map((v, i) => {
    const rec = at<{ tier?: string; subTier?: number; status?: number } | null>(5 + i)
    return {
      viewer: v.key,
      role: v.role,
      address: v.address,
      hasApass: rec !== null,
      tier: rec?.tier ?? null,
      subTier: rec?.subTier ?? null,
      // 1 = active, 2 = frozen. The lapse demo freezes and the reset reactivates.
      status: rec?.status ?? null,
    }
  })

  const commit = process.env.VENUE_COMMIT || null

  const body = {
    ok: block !== null && apass.some((a) => a.hasApass),
    build: {
      commit,
      commitUrl: commit && commit !== 'unknown' ? `${REPO}/commit/${commit}` : null,
      source: REPO,
      summary: `${PUBLIC_BASE}/summary`,
      llms: `${PUBLIC_BASE}/llms.txt`,
      evidenceRun: `${REPO}/blob/main/EVIDENCE-RUN.md`,
      onePage: `${REPO}/blob/main/ONE-PAGE-SUMMARY.md`,
    },
    checks: {
      monadRpcReachable: block !== null,
      cleanverseRegistryReachable: apass.some((a) => a.hasApass),
      cashLegIsRealCleanverseAsset:
        addresses.cash?.toLowerCase() === AUSDC.toLowerCase(),
      contractsConfigured: Boolean(addresses.security && addresses.settlement && addresses.policy),
      threeDistinctCviStates:
        new Set(apass.map((a) => `${a.hasApass}:${a.subTier}`)).size === 3,
    },
    chain: { name: 'Monad testnet', chainId: 10143, block: block?.toString() ?? null },
    contracts: {
      security: addresses.security,
      cash: addresses.cash,
      settlement: addresses.settlement,
      policyInstance: addresses.policy,
      cleanverseValidator:
        process.env.POLICY_ADDRESS ?? '0xaC7e5179C2C7f03f209136886c172eb34F161792',
    },
    asset: {
      rule: rules?.[0]
        ? `minSubTier ${String(rules[0].minSubTier)}`
        : 'no rules (transfers as a plain ERC-20)',
      holders: holders !== null && cap !== null ? `${holders}/${cap}` : null,
    },
    identities: apass,
    settlementAgentGasWei: agentGas?.toString() ?? null,
    // Whether one instance is serving, and whether the limiter sees a stable client key.
    instance: { ...limiterState(), seesClientAs: clientKey(req) },
    notes: {
      cashLeg: 'Cleanverse aUSDC. Enforces CVI on transfer: a wallet with no A-Pass cannot receive it.',
      gate:
        'canTransfer is absent from the Cleanverse validator, so the token gates against an instance of the documented IATokenPolicy whose sub-tiers mirror live CVI.',
    },
  }

  return NextResponse.json(body, { headers: { 'cache-control': 'no-store' } })
}
