/**
 * Seed the demo: credentials, balances, approvals and a resting book.
 *
 *   pnpm tsx scripts/seed.ts
 *
 * Market makers are derived deterministically from a fixed label rather than stored, so
 * this is reproducible from a cold start. They exist because a depth ladder needs more than
 * two participants and we hold three funded keys; they carry the same eligibility as viewer
 * A, so they add depth without adding a second compliance story.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatEther, keccak256, parseEther, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { account, artifact, loadEnv, publicClient, ROOT, walletClient } from './lib/chain'
import { viewers } from './lib/demo'

loadEnv()

/**
 * Four makers hold the security and provide depth. A fifth is credentialed and holds cash
 * but no security, so it is an eligible *non-holder*: bidding would consume a holder slot.
 * That is the party the cap passes over in favour of a worse-priced incumbent.
 */
const MAKER_COUNT = 5
const NON_HOLDER_INDEX = 4
const MAKER_GAS = parseEther('0.05')
const SECURITY_PER_MAKER = 5_000n
const CASH_PER_MAKER = 5_000_000n

/** Deterministic, so a re-seed reuses the same addresses and existing state still applies. */
function makerKey(i: number): `0x${string}` {
  return keccak256(toHex(`venue-market-maker-${i}`))
}

async function main() {
  const pub = publicClient()
  const owner = walletClient('W_PKEY')
  const policy = process.env.MOCK_POLICY_ADDRESS as `0x${string}`
  const security = process.env.LISTED_ADDRESS as `0x${string}`
  const cash = process.env.CASH_ADDRESS as `0x${string}`
  const settlement = process.env.SETTLEMENT_ADDRESS as `0x${string}`
  if (!policy || !security || !cash || !settlement) {
    throw new Error('deploy first - addresses missing from .env')
  }

  const { abi: policyAbi } = artifact('MockPolicy')
  const { abi: listedAbi } = artifact('Listed')

  const send = async (req: Parameters<typeof owner.writeContract>[0]) => {
    const hash = await owner.writeContract(req)
    await pub.waitForTransactionReceipt({ hash })
    return hash
  }

  // ---- 1. credentials, on MockPolicy ---------------------------------------
  console.log('credentials:')
  for (const v of viewers()) {
    if (v.credential === null) {
      await send({
        address: policy,
        abi: policyAbi,
        functionName: 'clearCredential',
        args: [v.address],
      } as never)
      console.log(`  [${v.key}] ${v.address}  none - ${v.note}`)
      continue
    }
    const c = v.credential
    await send({
      address: policy,
      abi: policyAbi,
      functionName: 'setCredential',
      args: [v.address, c.group, c.subGroup, c.tier, c.subTier, 0n],
    } as never)
    console.log(`  [${v.key}] ${v.address}  tier ${c.tier} subTier ${c.subTier} - ${v.note}`)
  }

  // ---- 2. market makers ----------------------------------------------------
  const makers = Array.from({ length: MAKER_COUNT }, (_, i) => privateKeyToAccount(makerKey(i)))
  console.log('\nmarket makers:')
  for (const [i, m] of makers.entries()) {
    await send({
      address: policy,
      abi: policyAbi,
      functionName: 'setCredential',
      args: [m.address, '0x0000', '0x4344', 34, 75, 0n],
    } as never)

    const bal = await pub.getBalance({ address: m.address })
    if (bal < MAKER_GAS / 2n) {
      const hash = await owner.sendTransaction({ to: m.address, value: MAKER_GAS })
      await pub.waitForTransactionReceipt({ hash })
    }
    console.log(`  maker ${i} ${m.address}  ${formatEther(await pub.getBalance({ address: m.address }))} MON`)
  }

  // ---- 3. balances ---------------------------------------------------------
  console.log('\nminting:')
  const viewerA = viewers()[0]!
  const everyone = [...makers.map((m) => m.address), viewerA.address]
  for (const [i, h] of everyone.entries()) {
    // The non-holder gets cash but never the security - that is what makes it a non-holder.
    if (i !== NON_HOLDER_INDEX) {
      await send({
        address: security,
        abi: listedAbi,
        functionName: 'mint',
        args: [h, SECURITY_PER_MAKER],
      } as never)
    }
    await send({
      address: cash,
      abi: listedAbi,
      functionName: 'mint',
      args: [h, CASH_PER_MAKER],
    } as never)
  }
  const holders = everyone.filter((_, i) => i !== NON_HOLDER_INDEX)
  const holderCount = await pub.readContract({
    address: security,
    abi: listedAbi,
    functionName: 'holderCount',
  })
  console.log(`  ${holders.length} holders funded, on-chain holderCount = ${holderCount}`)

  // ---- 4. approvals - D7, the funding check --------------------------------
  console.log('\napprovals to settlement:')
  for (const m of makers) {
    const w = walletClient('W_PKEY')
    const mw = { ...w, account: m }
    for (const token of [security, cash]) {
      const hash = await mw.writeContract({
        account: m,
        address: token,
        abi: listedAbi,
        functionName: 'approve',
        args: [settlement, (1n << 255n) - 1n],
        chain: w.chain,
      } as never)
      await pub.waitForTransactionReceipt({ hash })
    }
    console.log(`  ${m.address} approved both legs`)
  }
  for (const token of [security, cash]) {
    await send({
      address: token,
      abi: listedAbi,
      functionName: 'approve',
      args: [settlement, (1n << 255n) - 1n],
    } as never)
  }
  console.log(`  ${viewerA.address} approved both legs`)

  // ---- 5. hand the maker keys to the venue service -------------------------
  const out = join(ROOT, '.venue-makers.json')
  writeFileSync(
    out,
    JSON.stringify(
      makers.map((m, i) => ({ index: i, address: m.address, privateKey: makerKey(i) })),
      null,
      2,
    ),
  )
  console.log(`\nmaker keys -> ${out} (gitignored)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
