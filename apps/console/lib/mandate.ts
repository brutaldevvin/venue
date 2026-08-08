import type { Address } from '@venue/core'
import { canonicalMandate, MandateVerifier } from '@venue/cleanverse'
import type { SettlementMandate, SignedMandate } from '@venue/cleanverse'
import { privateKeyToAccount } from 'viem/accounts'
import { addresses } from './chain'

/**
 * The operator mandate under which the settlement agent acts.
 *
 * In a deployment the operator signs this out of band and hands the agent the signature;
 * the agent never holds the operator's key. Here both live in the same process, so the
 * mandate is minted at startup - but it is a real EIP-191 signature over the canonical
 * form, verified on every settle, and the agent has no authority without it.
 */
function key(name: string): `0x${string}` {
  const raw = process.env[name] ?? ''
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
}

let cached: SignedMandate | null = null

export async function agentMandate(): Promise<SignedMandate> {
  if (cached) return cached

  const operator = privateKeyToAccount(key('W_PKEY'))
  const agent = privateKeyToAccount(key('FACILITATOR_PKEY'))

  const mandate: SettlementMandate = {
    principal: operator.address as Address,
    agent: agent.address as Address,
    venue: addresses.settlement,
    asset: addresses.security,
    maxQty: '10000',
    maxNotional: '1000000000',
    nonce: `venue-${addresses.settlement.slice(2, 10)}`,
    expiresAt: Math.floor(Date.now() / 1000) + 86_400,
  }

  cached = {
    mandate,
    signature: await operator.signMessage({ message: canonicalMandate(mandate) }),
  }
  return cached
}

export const mandateVerifier = ((globalThis as { __venueMandate?: MandateVerifier })
  .__venueMandate ??= new MandateVerifier())
