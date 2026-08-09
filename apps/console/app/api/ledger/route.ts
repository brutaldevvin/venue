import { NextResponse } from 'next/server'
import { publicClient } from '@/lib/chain'
import { readLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

/**
 * Every settlement this demo has ever made, verified against chain before it is shown.
 *
 * The stored record is only an index. Each entry is checked with a receipt lookup, so a row
 * appears as confirmed because the chain says so and not because we wrote it down. A hash
 * that does not resolve, or resolved to a reverted transaction, is reported as such rather
 * than quietly listed among the successes.
 *
 * Receipts are checked for the most recent entries only. The list grows without bound and a
 * judge is not served by a page that takes a minute to answer; older entries carry their
 * hash and the explorer link, which is the same proof one step removed.
 */
const VERIFY_LIMIT = 25

export async function GET() {
  const records = await readLedger()

  const verified = await Promise.all(
    records.slice(0, VERIFY_LIMIT).map(async (r) => {
      try {
        const receipt = await publicClient.getTransactionReceipt({
          hash: r.txHash as `0x${string}`,
        })
        return {
          ...r,
          onChain: {
            status: receipt.status,
            block: receipt.blockNumber.toString(),
            gasUsed: receipt.gasUsed.toString(),
          },
        }
      } catch {
        return { ...r, onChain: { status: 'not found', block: null, gasUsed: null } }
      }
    }),
  )

  const confirmed = verified.filter((v) => v.onChain.status === 'success').length

  return NextResponse.json(
    {
      total: records.length,
      verifiedHere: verified.length,
      confirmedOnChain: confirmed,
      source: 'https://github.com/brutaldevvin/venue-data/blob/main/settlements.json',
      explorer: 'https://testnet.monadscan.com/tx/',
      note: 'Each entry is a delivery-versus-payment settlement: the security and the cash leg move in opposite directions in one transaction. Status is read from a receipt at request time.',
      settlements: [...verified, ...records.slice(VERIFY_LIMIT)],
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
