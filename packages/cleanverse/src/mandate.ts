import type { Address } from '@venue/core'
import { verifyMessage } from 'viem'

/**
 * An operator mandate authorising an agent to settle on Venue's behalf.
 *
 * The operator signs it once; the settlement agent presents it on every settle. The
 * signature binds the authority to the operator's key, so the agent's power is delegated
 * and bounded rather than assumed - it can settle this asset, on this venue, up to these
 * sizes, until this expiry, and nothing else.
 */
export interface SettlementMandate {
  /** Who grants the authority. The signature must recover to this address. */
  principal: Address
  /** Who may settle under it. */
  agent: Address
  /** The settlement contract the authority is scoped to. */
  venue: Address
  /** The asset the authority is scoped to. */
  asset: Address
  /** Per-settlement ceilings, as decimal strings so the signed bytes carry no precision. */
  maxQty: string
  maxNotional: string
  /** Unique per mandate. Used for revocation, not burned on use - see MandateVerifier. */
  nonce: string
  /** Unix seconds. Rejected at or after this. */
  expiresAt: number
}

export interface SignedMandate {
  mandate: SettlementMandate
  /** EIP-191 personal_sign over canonicalMandate(mandate), by `mandate.principal`. */
  signature: `0x${string}`
}

export type MandateError =
  | 'malformed_mandate'
  | 'mandate_expired'
  | 'invalid_signature'
  | 'mandate_revoked'
  | 'wrong_agent'
  | 'wrong_venue'
  | 'wrong_asset'
  | 'exceeds_max_qty'
  | 'exceeds_max_notional'

/** Canonical JSON with a fixed key order, so the signed bytes are deterministic. */
export function canonicalMandate(m: SettlementMandate): string {
  return JSON.stringify({
    principal: m.principal,
    agent: m.agent,
    venue: m.venue,
    asset: m.asset,
    maxQty: m.maxQty,
    maxNotional: m.maxNotional,
    nonce: m.nonce,
    expiresAt: m.expiresAt,
  })
}

export interface SettlementRequest {
  agent: Address
  venue: Address
  asset: Address
  qty: bigint
  notional: bigint
}

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/**
 * Verifies a mandate and authorises one settlement under it.
 *
 * The nonce is deliberately *not* burned on use. A settlement mandate authorises an
 * ongoing relationship - an agent that could settle only once would need a fresh operator
 * signature per trade, which defeats the purpose. Replay protection for the settlement
 * itself comes from the order nonces and the match id, not from here; the nonce exists so
 * a mandate can be revoked before its expiry.
 */
export class MandateVerifier {
  private readonly revoked = new Set<string>()

  constructor(private readonly now: () => number = () => Date.now()) {}

  revoke(nonce: string): void {
    this.revoked.add(nonce)
  }

  async authorize(
    sm: SignedMandate,
    req: SettlementRequest,
  ): Promise<{ ok: true; mandate: SettlementMandate } | { ok: false; reason: MandateError }> {
    const m = sm?.mandate
    if (
      !m ||
      !m.principal ||
      !m.agent ||
      !m.venue ||
      !m.asset ||
      !m.nonce ||
      !m.expiresAt ||
      !sm.signature
    ) {
      return { ok: false, reason: 'malformed_mandate' }
    }
    if (m.expiresAt * 1000 <= this.now()) return { ok: false, reason: 'mandate_expired' }
    if (this.revoked.has(m.nonce)) return { ok: false, reason: 'mandate_revoked' }

    let valid = false
    try {
      valid = await verifyMessage({
        address: m.principal,
        message: canonicalMandate(m),
        signature: sm.signature,
      })
    } catch {
      valid = false
    }
    if (!valid) return { ok: false, reason: 'invalid_signature' }

    // Scope is checked after the signature, so an unsigned mandate cannot probe the
    // operator's limits by watching which error comes back.
    if (!eq(m.agent, req.agent)) return { ok: false, reason: 'wrong_agent' }
    if (!eq(m.venue, req.venue)) return { ok: false, reason: 'wrong_venue' }
    if (!eq(m.asset, req.asset)) return { ok: false, reason: 'wrong_asset' }
    if (req.qty > BigInt(m.maxQty)) return { ok: false, reason: 'exceeds_max_qty' }
    if (req.notional > BigInt(m.maxNotional)) return { ok: false, reason: 'exceeds_max_notional' }

    return { ok: true, mandate: m }
  }
}
