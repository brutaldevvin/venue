/**
 * Pre-flight against the deployed CCP policy, before anything is redeployed.
 *
 *   pnpm tsx scripts/probe-real-policy.ts
 *
 * Three questions decide whether the demo can run on the real policy and registry instead
 * of our own test double. Each is answered with an eth_call against 0xaC7e...1792 using RVS,
 * a CVA that is already registered there with a known rule of minSubTier 70.
 *
 *   1. Does canTransfer allow a mint, where `from` is the zero address and holds no
 *      credential? If not, we cannot issue the security to anyone.
 *   2. Is the sub-tier threshold `>` or `>=`? The v3 docs say a holder is allowed when their
 *      subTier is "greater than" the value, but our rule evaluation implements `>=`. If the
 *      docs are right, a holder exactly at the threshold passes locally and is refused on
 *      chain, which is the exact disagreement invariant 2 exists to catch.
 *   3. Does a credential we mint through generate_apass actually satisfy a real rule?
 *
 * It issues A-Passes at sub-tier 70 and 71 to two deterministic wallets so the boundary can
 * be read directly: at a threshold of 70, `>` admits only 71 while `>=` admits both.
 */
import { keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { aesEncrypt, loadConfigFromEnv } from '../packages/cleanverse/src/index'
import { loadEnv, publicClient } from './lib/chain'

loadEnv()

const POLICY = '0xaC7e5179C2C7f03f209136886c172eb34F161792' as const
const RVS = '0x38d55e73a3ddd8086e9592f41ad2ce27dcae3385' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

const policyAbi = [
  {
    type: 'function',
    name: 'canTransfer',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const

const probeKey = (label: string) => keccak256(toHex(`venue-policy-probe-${label}`))

/** The deployed policy refuses by reverting, so a revert is a "no", not an error. */
async function canTransfer(from: string, to: string): Promise<string> {
  const pub = publicClient()
  try {
    const ok = await pub.readContract({
      address: POLICY,
      abi: policyAbi,
      functionName: 'canTransfer',
      args: [RVS, from as `0x${string}`, to as `0x${string}`, 1n],
    })
    return ok ? 'ALLOWED' : 'refused (returned false)'
  } catch {
    return 'refused (reverted)'
  }
}

async function issue(cfg: ReturnType<typeof loadConfigFromEnv>, address: string, subTier: number) {
  const body = {
    customerId: `venueprobe${subTier}${address.slice(2, 10)}`,
    subTier,
    subGroup: 'CD',
    expirationTime: 1893456000, // 2030-01-01
    wallet: { address, chain: 'monad' },
  }
  const res = await fetch(`${cfg.cooperateBase}/generate_apass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-id': cfg.apiId },
    body: JSON.stringify({ data: aesEncrypt(JSON.stringify(body), cfg.appKey) }),
  })
  return (await res.text()).slice(0, 200)
}

async function apass(cfg: ReturnType<typeof loadConfigFromEnv>, address: string) {
  const res = await fetch(`${cfg.cooperateBase}/query_apass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-id': cfg.apiId },
    body: JSON.stringify({ chain: 'monad', address }),
  })
  const j = (await res.json()) as { code: string; data?: { tier?: string; subTier?: number } }
  return j.code === '0000' ? `tier=${j.data?.tier} subTier=${j.data?.subTier}` : `none (${j.code})`
}

async function main() {
  const cfg = loadConfigFromEnv()
  const at70 = privateKeyToAccount(probeKey('70'))
  const at71 = privateKeyToAccount(probeKey('71'))

  console.log(`RVS rule is minSubTier 70. Probing the boundary.\n`)
  console.log(`  wallet at subTier 70: ${at70.address}`)
  console.log(`  wallet at subTier 71: ${at71.address}\n`)

  for (const [w, t] of [
    [at70, 70],
    [at71, 71],
  ] as const) {
    console.log(`  issue subTier ${t}: ${await issue(cfg, w.address, t)}`)
  }

  await new Promise((r) => setTimeout(r, 4000))
  for (const [w, t] of [
    [at70, 70],
    [at71, 71],
  ] as const) {
    console.log(`  query subTier ${t}: ${await apass(cfg, w.address)}`)
  }

  console.log('\n  Q1 mint, from = zero address:')
  console.log(`    zero -> subTier 71 wallet : ${await canTransfer(ZERO, at71.address)}`)
  console.log('\n  Q2 threshold, rule is minSubTier 70:')
  console.log(`    subTier 70 -> subTier 71  : ${await canTransfer(at70.address, at71.address)}`)
  console.log(`    subTier 71 -> subTier 70  : ${await canTransfer(at71.address, at70.address)}`)
  console.log('\n  Q3 control, an uncredentialed wallet:')
  console.log(`    zero -> uncredentialed    : ${await canTransfer(ZERO, '0x9c2795FbFdAd515504112234bf53A4F6e4b841Ce')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
