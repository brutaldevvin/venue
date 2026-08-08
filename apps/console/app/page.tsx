import Console from './console'
import { getState, type VenueState } from '@/lib/venue'

export const dynamic = 'force-dynamic'

/**
 * The route is a server component so the page has real content before any JavaScript runs.
 *
 * The console is interactive and therefore a client component, which means anything that
 * only appears after a fetch is invisible to whatever reads the page without executing it:
 * an agent, a crawler, a reader-mode view, a curl. The state is resolved here and passed
 * down as the initial value, so the three books, the addresses and the live figures are in
 * the markup on first byte, and the interactive version hydrates on top of the same data.
 *
 * `Facts` then states in plain prose what the panes show visually. That is not duplication
 * for its own sake: the demo's whole claim is that three viewers see three different books,
 * and that is worth asserting in text as well as in a chart.
 */
export default async function Page() {
  let state: VenueState | null = null
  try {
    state = await getState()
  } catch {
    // A dependency being down must not blank the page; the client retries on mount.
  }

  // bigint is not JSON, and the client expects the same shape the API returns.
  const initial = state
    ? (JSON.parse(JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as never)
    : null

  return (
    <>
      <Console initialState={initial} />
      <Facts state={state} />
    </>
  )
}

function short(a?: string) {
  return a ? `${a.slice(0, 10)}...${a.slice(-6)}` : 'unavailable'
}

/** A plain-text account of the same state the panes render, always present in the markup. */
function Facts({ state }: { state: VenueState | null }) {
  if (!state) return null
  const p = state.proof
  const rows = state.viewers.map((v) => {
    const cred = v.credential
      ? `tier ${v.credential.tier}, sub-tier ${v.credential.subTier}`
      : 'no A-Pass'
    const asks = v.visible.filter((o) => o.side === 'ask').length
    const bids = v.visible.filter((o) => o.side === 'bid').length
    const why = v.refusal ? `an empty book, ${v.refusal.constraint}` : `${asks} asks and ${bids} bids`
    return `Viewer ${v.key} (${v.address}) holds ${cred} and sees ${why}.`
  })

  return (
    <section className="px-8 py-8 border-t border-line text-body">
      <h2 className="font-ui font-bold text-indigo tracking-[-0.035em] text-[20px]">
        What this page is showing
      </h2>
      <p className="mt-3 max-w-[820px] text-[14px] leading-[1.6]">
        Venue is a compliant secondary market for tokenised real-world assets on Monad testnet
        (chainId {p.chainId}). One order book is projected separately for each viewer against
        their live Cleanverse Verified Identity, so the compliance check happens when a match is
        formed rather than when a transfer settles. An ineligible pair is never created, so no
        settlement reverts and refusals cost no gas.
      </p>
      <p className="mt-3 max-w-[820px] text-[14px] leading-[1.6]">
        The asset is {state.asset.name} ({state.asset.symbol}) at {state.asset.address}. Its rule
        set is {p.ruleSummary}. The holder cap stands at {state.limits.holderCount} of{' '}
        {state.limits.maxHolders}, so it binds: a bid from a party holding none of the asset is
        passed over in favour of a worse-priced bid from an existing holder, and the tape names
        the rule that skipped it.
      </p>
      <ul className="mt-3 max-w-[820px] text-[14px] leading-[1.7] list-disc pl-5">
        {rows.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="mt-3 max-w-[820px] text-[14px] leading-[1.6]">
        Delivery versus payment settles both legs in one transaction through the settlement
        contract at {p.settlement}, which is never the sender or the recipient of either leg. The
        cash leg is Cleanverse aUSDC itself at {p.cash}, which enforces Cleanverse Verified
        Identity on transfer, so a wallet with no A-Pass cannot receive it. The security is a
        Cleanverse Verified Asset at {p.security}. Compliance rules are read from the Cleanverse
        validator at {p.ccpPolicy}; because that contract does not expose canTransfer, the token
        gates against an instance of the documented IATokenPolicy at {p.policy} whose sub-tiers
        mirror the live registry.
      </p>
      <p className="mt-3 max-w-[820px] font-mono text-[11px] text-muted">
        Machine readable:{' '}
        <a className="text-indigo hover:underline" href="/api/health">
          /api/health
        </a>{' '}
        checks every dependency,{' '}
        <a className="text-indigo hover:underline" href="/api/state">
          /api/state
        </a>{' '}
        returns this projection as JSON, and{' '}
        <a className="text-indigo hover:underline" href="/llms.txt">
          /llms.txt
        </a>{' '}
        summarises both. Source at github.com/brutaldevvin/venue. Projection latency for all
        three viewers was {state.latencyMs} ms. Contracts: security {short(p.security)}, cash{' '}
        {short(p.cash)}, settlement {short(p.settlement)}.
      </p>
    </section>
  )
}
