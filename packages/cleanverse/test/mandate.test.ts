import { describe, expect, it } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address } from '@venue/core'
import { canonicalMandate, MandateVerifier } from '../src/mandate'
import type { SettlementMandate, SignedMandate } from '../src/mandate'

const PRINCIPAL_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const
const OTHER_KEY = '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as const

const principal = privateKeyToAccount(PRINCIPAL_KEY)
const NOW = 1_800_000_000_000 // ms

const AGENT = '0x000000000000000000000000000000000000A9E7' as Address
const VENUE = '0x000000000000000000000000000000000000BEEF' as Address
const ASSET = '0x000000000000000000000000000000000000CAFE' as Address

function mandate(over: Partial<SettlementMandate> = {}): SettlementMandate {
  return {
    principal: principal.address,
    agent: AGENT,
    venue: VENUE,
    asset: ASSET,
    maxQty: '1000',
    maxNotional: '10000000',
    nonce: 'mandate-1',
    expiresAt: Math.floor(NOW / 1000) + 3600,
    ...over,
  }
}

async function sign(m: SettlementMandate, key: `0x${string}` = PRINCIPAL_KEY): Promise<SignedMandate> {
  const acct = privateKeyToAccount(key)
  return { mandate: m, signature: await acct.signMessage({ message: canonicalMandate(m) }) }
}

const req = (over: Partial<Parameters<MandateVerifier['authorize']>[1]> = {}) => ({
  agent: AGENT,
  venue: VENUE,
  asset: ASSET,
  qty: 100n,
  notional: 1_000_000n,
  ...over,
})

const verifier = () => new MandateVerifier(() => NOW)

describe('settlement mandate', () => {
  it('authorises a settlement within scope', async () => {
    const res = await verifier().authorize(await sign(mandate()), req())
    expect(res.ok).toBe(true)
  })

  it('rejects a mandate signed by anyone but the principal', async () => {
    const m = mandate()
    const forged = await sign(m, OTHER_KEY)
    const res = await verifier().authorize(forged, req())
    expect(res).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('rejects a tampered field even with a valid-looking signature', async () => {
    const signed = await sign(mandate())
    // Raise the ceiling after signing - the canonical form changes, so recovery fails.
    const tampered = { ...signed, mandate: { ...signed.mandate, maxQty: '999999' } }
    const res = await verifier().authorize(tampered, req({ qty: 5000n }))
    expect(res).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('rejects an expired mandate', async () => {
    const res = await verifier().authorize(
      await sign(mandate({ expiresAt: Math.floor(NOW / 1000) - 1 })),
      req(),
    )
    expect(res).toEqual({ ok: false, reason: 'mandate_expired' })
  })

  it('rejects a revoked mandate', async () => {
    const v = verifier()
    v.revoke('mandate-1')
    const res = await v.authorize(await sign(mandate()), req())
    expect(res).toEqual({ ok: false, reason: 'mandate_revoked' })
  })

  it('scopes authority to one agent, venue and asset', async () => {
    const v = verifier()
    const signed = await sign(mandate())
    expect(await v.authorize(signed, req({ agent: VENUE }))).toMatchObject({ reason: 'wrong_agent' })
    expect(await v.authorize(signed, req({ venue: ASSET }))).toMatchObject({ reason: 'wrong_venue' })
    expect(await v.authorize(signed, req({ asset: VENUE }))).toMatchObject({ reason: 'wrong_asset' })
  })

  it('enforces the size ceilings', async () => {
    const v = verifier()
    const signed = await sign(mandate())
    expect(await v.authorize(signed, req({ qty: 1001n }))).toMatchObject({
      reason: 'exceeds_max_qty',
    })
    expect(await v.authorize(signed, req({ notional: 10_000_001n }))).toMatchObject({
      reason: 'exceeds_max_notional',
    })
    // The boundary itself is allowed.
    expect(await v.authorize(signed, req({ qty: 1000n, notional: 10_000_000n }))).toMatchObject({
      ok: true,
    })
  })

  /**
   * A settlement mandate authorises an ongoing relationship. Burning the nonce on first use
   * - as a payment mandate would - means the operator has to sign again per trade, which
   * defeats the point of delegating at all.
   */
  it('stays valid across repeated settlements', async () => {
    const v = verifier()
    const signed = await sign(mandate())
    for (let i = 0; i < 3; i++) {
      expect(await v.authorize(signed, req())).toMatchObject({ ok: true })
    }
  })

  it('rejects a malformed mandate before touching the signature', async () => {
    const res = await verifier().authorize(
      { mandate: { ...mandate(), nonce: '' }, signature: '0x00' },
      req(),
    )
    expect(res).toEqual({ ok: false, reason: 'malformed_mandate' })
  })
})
