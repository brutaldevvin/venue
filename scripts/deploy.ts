/**
 * Deploy Venue to Monad testnet.
 *
 * Against MockPolicy, per decision D3: the policy is a constructor argument, so the same
 * bytecode runs against `0xaC7e...1792` once our CVA is registered. Deploying our own
 * policy is also what makes the promised demo possible at all - three CVI states on one
 * asset, rather than the two-listing workaround the identical demo wallets would force.
 *
 *   pnpm tsx scripts/deploy.ts
 *
 * Addresses are appended to .env on success.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { artifact, loadEnv, publicClient, ROOT, walletClient } from './lib/chain'

loadEnv()

/** The asset's rule set. Mirrors RVS, the live reference CVA: sub-tier 70 or better. */
const MIN_SUB_TIER = 70
/**
 * The cap is set to exactly the number of holders the seed creates, so it is already
 * binding when the demo starts. The submission's figure is 99; the mechanism is identical
 * at any number, and standing up 99 funded holders would prove nothing the cap does not.
 */
const MAX_HOLDERS = 5n

async function deploy(
  wallet: ReturnType<typeof walletClient>,
  pub: ReturnType<typeof publicClient>,
  name: string,
  args: unknown[],
): Promise<`0x${string}`> {
  const { abi, bytecode } = artifact(name)
  const hash = await wallet.deployContract({ abi, bytecode, args } as never)
  const receipt = await pub.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error(`${name} deploy produced no address`)
  console.log(`  ${name.padEnd(12)} ${receipt.contractAddress}  (${hash})`)
  return receipt.contractAddress
}

async function main() {
  const pub = publicClient()
  const wallet = walletClient('W_PKEY')
  const owner = wallet.account.address
  const agent = (await import('./lib/chain')).account('FACILITATOR_PKEY').address

  const balance = await pub.getBalance({ address: owner })
  console.log(`deployer ${owner}  ${Number(balance) / 1e18} MON`)
  console.log(`agent    ${agent}\n`)

  const policy = await deploy(wallet, pub, 'MockPolicy', [])
  const security = await deploy(wallet, pub, 'Listed', [
    'ReVault Reg S T-Bill',
    'RVS',
    policy,
    MAX_HOLDERS,
    owner,
  ])
  // The cash leg is a CVA stablecoin under the same policy, so DvP moves both at once.
  const cash = await deploy(wallet, pub, 'Listed', [
    'Cleanverse USD',
    'aUSDC',
    policy,
    (1n << 255n) - 1n,
    owner,
  ])
  const settlement = await deploy(wallet, pub, 'Settlement', [security, cash, agent, owner])

  // Both tokens carry the same rule set, so the set who can settle is exactly the set the
  // book was projected for.
  const { abi: policyAbi } = artifact('MockPolicy')
  const rule = {
    allowedGroup: '0x0000' as const,
    allowedSubGroup: '0x0000' as const,
    minTier: 0,
    minSubTier: MIN_SUB_TIER,
    isBlackList: false,
    countryBitmap: 0n,
  }
  for (const [label, token] of [
    ['security', security],
    ['cash', cash],
  ] as const) {
    const hash = await wallet.writeContract({
      address: policy,
      abi: policyAbi,
      functionName: 'setRuleV2',
      args: [token, rule],
    } as never)
    await pub.waitForTransactionReceipt({ hash })
    console.log(`  rule on ${label}: minSubTier ${MIN_SUB_TIER}`)
  }

  const envPath = join(ROOT, '.env')
  const current = readFileSync(envPath, 'utf8')
  const cleaned = current
    .split('\n')
    .filter(
      (l) =>
        !/^(MOCK_POLICY_ADDRESS|LISTED_ADDRESS|CASH_ADDRESS|SETTLEMENT_ADDRESS)=/.test(l.trim()),
    )
    .join('\n')
  writeFileSync(
    envPath,
    `${cleaned.trimEnd()}\n\nMOCK_POLICY_ADDRESS=${policy}\nLISTED_ADDRESS=${security}\nCASH_ADDRESS=${cash}\nSETTLEMENT_ADDRESS=${settlement}\n`,
  )
  console.log('\naddresses written to .env')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
