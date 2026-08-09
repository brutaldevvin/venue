/**
 * Backfill the public settlement ledger from settlements already made.
 *
 *   pnpm tsx scripts/seed-ledger.ts            # verify and print
 *   pnpm tsx scripts/seed-ledger.ts --write    # also write settlements.json locally
 *
 * Every hash below came out of a real run during development. Rather than trust that list,
 * each one is fetched and decoded: a hash only survives if its receipt succeeded and its
 * logs show two ERC-20 transfers moving in opposite directions between the same two parties,
 * which is what makes it a delivery-versus-payment settlement rather than an ordinary
 * transfer. Anything that fails those checks is dropped with a reason.
 *
 * The output is committed to brutaldevvin/venue-data, which the console reads.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, publicClient, ROOT } from './lib/chain'

loadEnv()

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** Settlements observed during development, across several deployments of the contracts. */
const CANDIDATES = [
  '0x1099a0836c504280975cf64ef734e5f32afc600732e121d6d86a76b5b63f0110',
  '0x133d7ffd82299c45fe59b24b375e1b80c91ddfaa21c1f250e223dd44b9b2d498',
  '0xd3c40692c7fe6e7aa58074c976e22d566d0628de07bb4a4d4f3400ce2be0997a',
  '0x3d65b6fef431eec0c6d35215fd0085aced84303200f55357dcb432ee200456f0',
  '0xae6a75acb860cf3a536a54c504e0be94346f8f165e81a2dd8e5d0879ce2d008e',
  '0x8070d8611c48f4a67e9ebfca9f27a0147a59f5e576df3e7e9b6c9225c3414ce0',
  '0xf5697c6ede8ec711719e70b7405b0d7d3c1d4545be4b013605d582ee7876c2a3',
  '0xa3c02780cf60c894afe492c7b4c534959602677e27d9517ea7d4d0605effa1c3',
  '0x2d902a562d4cb7de2e107653d59676b7f553a94b1300546fd9a5bb7cf4b2e562',
  '0xcf70db2ef3ba66bf1688242eea9d2a7981a8d15a2879d9fb78e3351aec862697',
  '0x802e3909a8362f4939bba3189ad1d21916c24c5b478b2b5b4e6946bcccec5561',
]

const addr = (topic: string) => `0x${topic.slice(-40)}`

async function main() {
  const pub = publicClient()
  const out: Record<string, unknown>[] = []

  for (const txHash of CANDIDATES) {
    try {
      const receipt = await pub.getTransactionReceipt({ hash: txHash as `0x${string}` })
      if (receipt.status !== 'success') {
        console.log(`  skip ${txHash.slice(0, 12)}  reverted`)
        continue
      }
      const transfers = receipt.logs
        .filter((l) => l.topics[0] === TRANSFER && l.topics.length >= 3)
        .map((l) => ({
          token: l.address,
          from: addr(l.topics[1] as string),
          to: addr(l.topics[2] as string),
          amount: BigInt(l.data).toString(),
        }))

      // Two legs, opposite directions, same pair: that is what makes it DvP.
      if (transfers.length !== 2) {
        console.log(`  skip ${txHash.slice(0, 12)}  ${transfers.length} transfers, not a DvP pair`)
        continue
      }
      const [a, b] = transfers as [(typeof transfers)[0], (typeof transfers)[0]]
      if (a.from.toLowerCase() !== b.to.toLowerCase() || a.to.toLowerCase() !== b.from.toLowerCase()) {
        console.log(`  skip ${txHash.slice(0, 12)}  legs are not between the same two parties`)
        continue
      }

      const block = await pub.getBlock({ blockNumber: receipt.blockNumber })
      out.push({
        txHash,
        at: new Date(Number(block.timestamp) * 1000).toISOString(),
        qty: a.amount,
        price: String(Math.round(Number(b.amount) / Number(a.amount))),
        notional: b.amount,
        seller: a.from,
        buyer: a.to,
        security: a.token,
        cash: b.token,
        settlement: receipt.to,
        chainId: 10143,
      })
      console.log(`  keep ${txHash.slice(0, 12)}  ${a.amount} security vs ${b.amount} cash`)
    } catch {
      console.log(`  skip ${txHash.slice(0, 12)}  not found`)
    }
  }

  out.sort((x, y) => String(y.at).localeCompare(String(x.at)))
  const json = `${JSON.stringify(out, null, 2)}\n`

  console.log(`\n  ${out.length} of ${CANDIDATES.length} verified as settlements`)
  if (process.argv.includes('--write')) {
    const p = join(ROOT, 'settlements.json')
    writeFileSync(p, json)
    console.log(`  wrote ${p}; commit it to brutaldevvin/venue-data`)
  } else {
    console.log('  pass --write to emit settlements.json')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
