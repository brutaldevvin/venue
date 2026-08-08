/**
 * Switch the cash leg to the real Cleanverse aUSDC and mirror live CVI into the gate.
 *
 *   pnpm tsx scripts/use-ausdc.ts
 *
 * Two changes, both aimed at the same thing: the demo should move real Cleanverse assets
 * between wallets holding real Cleanverse credentials.
 *
 * 1. `Settlement` is redeployed with `cash` pointing at aUSDC. Only `Settlement` changes,
 *    because the cash address is a constructor argument; `Listed` keeps its address so the
 *    security contract stays stable across this migration.
 *
 * 2. Each participant's credential is read from `query_apass` and written into the policy
 *    instance the token gates on, so the on-chain check enforces the sub-tier Cleanverse
 *    actually holds rather than a number we invented. The deployed validator exposes no
 *    `canTransfer` to call directly, so this mirroring is what keeps the gate honest.
 *
 * aUSDC carries no rules, so it transfers as a plain ERC-20 and any wallet can hold it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatUnits, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { CleanverseClient, toCredential } from '../packages/cleanverse/src/index'
import { account, artifact, loadEnv, publicClient, ROOT, walletClient } from './lib/chain'

loadEnv()

const AUSDC = '0xaC0893567D43C3E7e6e35a72803df05416C1f20D' as const
/** Enough for many demo fills at ~0.1 aUSDC each, without draining the funded wallet. */
const CASH_PER_BUYER = 1_000_000n // 1.0 aUSDC at 6 decimals

const erc20 = parseAbi([
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
])

function cvClient(): CleanverseClient {
  return new CleanverseClient({
    apiId: process.env.CLEANVERSE_APP_ID ?? '',
    appKey: process.env.CLEANVERSE_APP_KEY ?? '',
    cooperateBase: process.env.CLEANVERSE_COOPERATE_BASE ?? '',
    skillsBase: process.env.CLEANVERSE_SKILLS_BASE ?? '',
  })
}

async function main() {
  const pub = publicClient()
  const owner = walletClient('W_PKEY')
  const policy = process.env.MOCK_POLICY_ADDRESS as `0x${string}`
  const security = process.env.LISTED_ADDRESS as `0x${string}`
  if (!policy || !security) throw new Error('deploy first')

  const { abi: policyAbi } = artifact('MockPolicy')
  const { abi: settlementAbi, bytecode: settlementBytecode } = artifact('Settlement')

  const makers: { address: `0x${string}`; privateKey: `0x${string}` }[] = JSON.parse(
    readFileSync(join(ROOT, '.venue-makers.json'), 'utf8'),
  )
  const viewerA = account('VIEWER_A_PKEY')
  const agent = account('FACILITATOR_PKEY')

  // ---- 1. Settlement, pointing at aUSDC ------------------------------------
  console.log('deploying Settlement with cash = aUSDC')
  const hash = await owner.deployContract({
    abi: settlementAbi,
    bytecode: settlementBytecode,
    args: [security, AUSDC, agent.address, owner.account.address],
  } as never)
  const rcpt = await pub.waitForTransactionReceipt({ hash })
  const settlement = rcpt.contractAddress as `0x${string}`
  console.log(`  Settlement ${settlement}  (${hash})`)

  // ---- 2. mirror live CVI into the gate ------------------------------------
  console.log('\nmirroring live CVI credentials into the policy')
  const cv = cvClient()
  const parties: { label: string; address: `0x${string}` }[] = [
    { label: 'viewer A', address: viewerA.address },
    { label: 'viewer B', address: account('W_PKEY').address },
    { label: 'viewer C', address: agent.address },
    ...makers.map((m, i) => ({ label: `maker ${i}`, address: m.address })),
  ]

  for (const p of parties) {
    const record = await cv.queryApass({ chain: process.env.CHAIN ?? 'monad', address: p.address })
    if (record === null) {
      const h = await owner.writeContract({
        address: policy,
        abi: policyAbi,
        functionName: 'clearCredential',
        args: [p.address],
      } as never)
      await pub.waitForTransactionReceipt({ hash: h })
      console.log(`  ${p.label.padEnd(9)} no A-Pass, cleared on chain`)
      continue
    }
    const c = toCredential(p.address, record)
    const h = await owner.writeContract({
      address: policy,
      abi: policyAbi,
      functionName: 'setCredential',
      args: [p.address, c.group, c.subGroup, c.tier, c.subTier, 0n],
    } as never)
    await pub.waitForTransactionReceipt({ hash: h })
    console.log(`  ${p.label.padEnd(9)} tier ${c.tier}, subTier ${c.subTier} mirrored from CVI`)
  }

  // ---- 3. fund and approve the cash leg ------------------------------------
  console.log('\nfunding buyers with real aUSDC')
  const buyers = [viewerA.address, ...makers.map((m) => m.address)]
  for (const b of buyers) {
    const bal = (await pub.readContract({
      address: AUSDC,
      abi: erc20,
      functionName: 'balanceOf',
      args: [b],
    })) as bigint
    if (bal < CASH_PER_BUYER) {
      const h = await owner.writeContract({
        address: AUSDC,
        abi: erc20,
        functionName: 'transfer',
        args: [b, CASH_PER_BUYER - bal],
      } as never)
      await pub.waitForTransactionReceipt({ hash: h })
    }
    console.log(`  ${b} ${formatUnits(bal < CASH_PER_BUYER ? CASH_PER_BUYER : bal, 6)} aUSDC`)
  }

  console.log('\napprovals to the new settlement')
  const max = (1n << 255n) - 1n
  for (const m of makers) {
    const w = { ...owner, account: privateKeyToAccount(m.privateKey) }
    for (const token of [security, AUSDC]) {
      const h = await w.writeContract({
        account: privateKeyToAccount(m.privateKey),
        address: token,
        abi: erc20,
        functionName: 'approve',
        args: [settlement, max],
        chain: owner.chain,
      } as never)
      await pub.waitForTransactionReceipt({ hash: h })
    }
  }
  for (const [label, acct] of [
    ['viewer A', viewerA],
    ['owner', account('W_PKEY')],
  ] as const) {
    const w = { ...owner, account: acct }
    for (const token of [security, AUSDC]) {
      const h = await w.writeContract({
        account: acct,
        address: token,
        abi: erc20,
        functionName: 'approve',
        args: [settlement, max],
        chain: owner.chain,
      } as never)
      await pub.waitForTransactionReceipt({ hash: h })
    }
    console.log(`  ${label} approved both legs`)
  }

  // ---- 4. record the new addresses -----------------------------------------
  const envPath = join(ROOT, '.env')
  const cleaned = readFileSync(envPath, 'utf8')
    .split('\n')
    .filter((l) => !/^(CASH_ADDRESS|SETTLEMENT_ADDRESS)=/.test(l.trim()))
    .join('\n')
  writeFileSync(
    envPath,
    `${cleaned.trimEnd()}\nCASH_ADDRESS=${AUSDC}\nSETTLEMENT_ADDRESS=${settlement}\n`,
  )
  console.log('\n.env updated: cash is real aUSDC, settlement redeployed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
