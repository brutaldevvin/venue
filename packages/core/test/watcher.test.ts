import { describe, expect, it } from 'vitest'
import { credentialLive } from '../src/rules'
import type { Credential } from '../src/types'
import { NOW } from './arbitraries'

const base: Credential = {
  address: '0x0000000000000000000000000000000000000001',
  group: '0x0000',
  subGroup: '0x4344',
  tier: 34,
  subTier: 75,
  countries: [],
  status: 1,
  expirationTime: NOW + 86_400,
}

/**
 * The watcher itself lives in the console (it needs chain access), but the predicate it
 * turns on is here, and these are the three states that must end an order's life.
 */
describe('credentialLive - what ends a resting order', () => {
  it('accepts a live credential', () => {
    expect(credentialLive(base, NOW)).toBe(true)
  })

  it('rejects a frozen credential', () => {
    expect(credentialLive({ ...base, status: 2 }, NOW)).toBe(false)
  })

  /**
   * The case a status-only watcher misses. An expiry emits no event - it just becomes true
   * one second - so polling is a correctness requirement here, not a shortcut.
   */
  it('rejects an expired credential even though its status is still active', () => {
    const expired = { ...base, status: 1, expirationTime: NOW - 1 }
    expect(expired.status).toBe(1)
    expect(credentialLive(expired, NOW)).toBe(false)
  })

  it('treats the expiry boundary as expired', () => {
    expect(credentialLive({ ...base, expirationTime: NOW }, NOW)).toBe(false)
    expect(credentialLive({ ...base, expirationTime: NOW + 1 }, NOW)).toBe(true)
  })
})
