/**
 * Top up testnet MON from the devnads faucet.
 *
 *   pnpm tsx scripts/faucet.ts                  # any demo wallet below the threshold
 *   pnpm tsx scripts/faucet.ts 0xabc… 0xdef…    # specific addresses
 *
 * 1 MON per request, 10 requests per address per day. Used so that seeding does not have to
 * drain the deployer to fund market makers.
 */
import { formatEther, parseEther } from 'viem'
import { account, loadEnv, publicClient } from './lib/chain'

loadEnv()

const FAUCET = 'https://agents.devnads.com/v1/faucet'
const CHAIN_ID = 10143
const TOP_UP_BELOW = parseEther('0.5')

async function request(address: string): Promise<string> {
  const res = await fetch(FAUCET, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chainId: CHAIN_ID, address }),
  })
  return `${res.status} ${(await res.text()).slice(0, 160)}`
}

async function main() {
  const pub = publicClient()
  const explicit = process.argv.slice(2).filter((a) => a.startsWith('0x'))

  const targets =
    explicit.length > 0
      ? explicit
      : ['W_PKEY', 'W2_PKEY', 'FACILITATOR_PKEY'].map((k) => account(k).address as string)

  for (const address of targets) {
    const before = await pub.getBalance({ address: address as `0x${string}` })
    if (explicit.length === 0 && before >= TOP_UP_BELOW) {
      console.log(`${address}  ${formatEther(before)} MON - skipped, above threshold`)
      continue
    }
    console.log(`${address}  ${formatEther(before)} MON -> ${await request(address)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
