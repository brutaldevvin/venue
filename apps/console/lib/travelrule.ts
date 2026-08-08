import type { Address } from '@venue/core'
import { CleanverseClient } from '@venue/cleanverse'

/**
 * A Travel Rule reference for one leg of a settled trade.
 *
 * Two legs move in a Venue fill - the security and the cash - and each is a separate
 * transfer between the same two parties in opposite directions, so each owes its own
 * record. A refusal moves no value and owes nothing at all, which is why this is only ever
 * called after a settlement succeeds.
 */
export interface LegReference {
  leg: 'security' | 'cash'
  from: Address
  to: Address
  /** The reference, when Cleanverse could produce one. */
  reference: string | null
  /** Why not, when it could not. Rendered as-is; it carries no PII. */
  unavailable?: string
}

function client(): CleanverseClient {
  return new CleanverseClient({
    apiId: process.env.CLEANVERSE_APP_ID ?? '',
    appKey: process.env.CLEANVERSE_APP_KEY ?? '',
    cooperateBase:
      process.env.CLEANVERSE_COOPERATE_BASE ?? 'https://uatapi.cleanverse.com/api/cooperate',
    skillsBase: process.env.CLEANVERSE_SKILLS_BASE ?? 'https://uatapi.cleanverse.com/api/skills',
  })
}

async function reference(
  txHash: string,
  leg: LegReference['leg'],
  from: Address,
  to: Address,
): Promise<LegReference> {
  try {
    const res = await client().downloadTravelRule({
      txHash,
      wallet: { chain: process.env.CHAIN ?? 'monad', address: from },
    })
    if (res.code === '0000') {
      const data = res.data as { reportId?: string; url?: string } | string | null
      const ref =
        typeof data === 'string'
          ? data
          : (data?.reportId ?? data?.url ?? JSON.stringify(data).slice(0, 64))
      return { leg, from, to, reference: ref }
    }
    return { leg, from, to, reference: null, unavailable: res.message.slice(0, 80) }
  } catch (e) {
    return { leg, from, to, reference: null, unavailable: (e as Error).message.slice(0, 80) }
  }
}

/**
 * Both legs of one fill. The security moves seller to buyer and the cash moves buyer to
 * seller, so the two references are not duplicates of each other - they are opposite
 * directions of the same trade.
 */
export async function travelRuleForFill(
  txHash: string,
  seller: Address,
  buyer: Address,
): Promise<LegReference[]> {
  return Promise.all([
    reference(txHash, 'security', seller, buyer),
    reference(txHash, 'cash', buyer, seller),
  ])
}
