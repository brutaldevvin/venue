import type { Address, Credential } from '@venue/core'
import { CleanverseClient, CredentialResolver, toCredential } from '@venue/cleanverse'

/**
 * Credentials come from the Cleanverse CVI registry, not from a contract we control.
 *
 * This is the read the whole product turns on: `project()` is a pure function over an
 * already-resolved credential, and this is where that credential comes from. Resolution is
 * cached with a short TTL and invalidated on a status change, because a stale credential is
 * the one cache bug that would show a viewer liquidity they cannot legally trade.
 */
const CHAIN = process.env.CHAIN ?? 'monad'

function client(): CleanverseClient {
  return new CleanverseClient({
    apiId: process.env.CLEANVERSE_APP_ID ?? '',
    appKey: process.env.CLEANVERSE_APP_KEY ?? '',
    cooperateBase:
      process.env.CLEANVERSE_COOPERATE_BASE ?? 'https://uatapi.cleanverse.com/api/cooperate',
    skillsBase: process.env.CLEANVERSE_SKILLS_BASE ?? 'https://uatapi.cleanverse.com/api/skills',
  })
}

interface CviStore {
  resolver: CredentialResolver
  links: Map<string, string>
}

/** Held on globalThis for the same reason the book is: Next gives each route its own module graph. */
const store: CviStore = ((globalThis as { __venueCvi?: CviStore }).__venueCvi ??= {
  resolver: new CredentialResolver(client(), CHAIN, 15_000),
  links: new Map(),
})

/** The live CVI credential for a wallet, or null when it holds no A-Pass. */
export async function resolveCredential(who: Address): Promise<Credential | null> {
  return store.resolver.resolve(who)
}

export async function resolveAll(
  addresses: readonly Address[],
): Promise<Map<Address, Credential | null>> {
  return store.resolver.resolveAll(addresses)
}

export function invalidate(who: Address): void {
  store.resolver.invalidate(who)
}

/**
 * Where an unverified viewer is sent, fetched from the registry rather than hardcoded.
 *
 * `canTransfer` refuses identically for "no credential" and "tier too low", so the chain
 * cannot say which. Only `verify_apass` can, and the "why" is what turns an empty pane into
 * onboarding. Cached per wallet because the answer does not change while they stay
 * unverified.
 */
export async function verificationLink(who: Address, asset: Address): Promise<string | undefined> {
  const cached = store.links.get(who.toLowerCase())
  if (cached) return cached
  try {
    const res = await client().verifyApass({ chain: CHAIN, atoken: asset, address: who })
    if (res.magickLink) {
      store.links.set(who.toLowerCase(), res.magickLink)
      return res.magickLink
    }
  } catch {
    // A registry hiccup must not blank the pane; the empty-book copy still explains why.
  }
  return undefined
}

/**
 * Freeze or reactivate a wallet's A-Pass at the registry.
 *
 * A lapse is a CVI event, not a contract edit. Freezing here is what a venue would actually
 * be told, and the cached credential is dropped immediately so the next projection reads the
 * new state rather than waiting out the TTL.
 */
export async function setApassStatus(who: Address, status: 1 | 2): Promise<boolean> {
  const res = await client().updateStatus({
    wallet: { chain: CHAIN, address: who },
    status,
    blacklistReason: status === 2 ? 'demo: credential lapsed' : undefined,
  })
  store.resolver.invalidate(who)
  return res.code === '0000'
}

export { toCredential }
