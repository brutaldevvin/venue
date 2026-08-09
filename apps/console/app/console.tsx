'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface Order {
  id: string
  maker: string
  side: 'bid' | 'ask'
  price: string
  qty: string
}
interface Refusal {
  reason: string
  constraint: string
}
interface Credential {
  tier: number
  subTier: number
  subGroup: string
  group: string
}
interface ViewerView {
  key: string
  label: string
  address: string
  credential: Credential | null
  visible: Order[]
  refusal: Refusal | null
  bound: Refusal[]
  verifyLink?: string
}
interface TapeRow {
  kind: 'fill' | 'skipped' | 'lapse' | 'refusal'
  at: number
  text: string
  rule?: string
  txHash?: string
  travelRule?: { leg: string; reference: string | null; unavailable?: string }[]
}
interface Rule {
  minTier: number
  minSubTier: number
  allowedGroup: string
  allowedSubGroup: string
}
interface Proof {
  network: string
  chainId: number
  explorer: string
  policy: string
  security: string
  cash: string
  settlement: string
  ccpPolicy: string
  ruleSummary: string
}
interface State {
  proof: Proof
  asset: { address: string; symbol: string; name: string }
  rules: Rule[]
  limits: { maxHolders: number; holderCount: number; positionLimit: string; lockupUntil: number }
  viewers: ViewerView[]
  tape: TapeRow[]
  latencyMs: number
}

/**
 * Glyphs outside the Latin subset of the self-hosted fonts. Rendering them in the system
 * stack avoids the wrong-glyph fallback that turned the lapse marker into a stray letter.
 */
const SYM = { style: { fontFamily: 'ui-monospace, monospace' } } as const

const short = (a?: string) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '-')

/**
 * Every address on the page resolves to the explorer.
 *
 * A judge's first instinct is to check whether an address is real, so nothing that looks
 * like one should be dead text. `onField` inverts the colour for the indigo bands, where
 * indigo type would be invisible.
 */
function AddressLink({
  address,
  explorer,
  label,
  onField,
}: {
  address?: string
  explorer?: string
  label?: string
  onField?: boolean
}) {
  const text = label ?? short(address)
  if (!address || !explorer) {
    return <span className={onField ? 'opacity-60' : 'text-muted'}>{text}</span>
  }
  return (
    <a
      href={`${explorer}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={address}
      className={
        onField ? 'underline opacity-80 hover:opacity-100' : 'text-indigo hover:underline'
      }
    >
      {text}
    </a>
  )
}

export default function Console({ initialState }: { initialState: State | null }) {
  const [state, setState] = useState<State | null>(initialState)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)

  const [firing, setFiring] = useState<Set<string>>(new Set())
  const prevBound = useRef<Set<string>>(new Set())
  /** Beat 1 is that the three books are *already* different. Nothing flashes on first paint. */
  const seenFirstLoad = useRef(initialState !== null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      const json = (await res.json()) as State & { error?: string }
      if (json.error) setError(json.error)
      else {
        const bound = new Set<string>()
        for (const v of json.viewers) {
          for (const b of v.bound) bound.add(`${v.key}:${b.reason}`)
          if (v.refusal) bound.add(`${v.key}:${v.refusal.reason}`)
        }
        const justFired = seenFirstLoad.current
          ? new Set([...bound].filter((k) => !prevBound.current.has(k)))
          : new Set<string>()
        seenFirstLoad.current = true
        prevBound.current = bound
        setFiring(justFired)
        setState(json)
        setError(null)
      }
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  // Polling at 1s is sufficient for a demo and removes a whole class of bug.
  useEffect(() => {
    load()
    const t = setInterval(load, 1000)
    return () => clearInterval(t)
  }, [load])

  const run = async (action: 'match' | 'lapse' | 'cross' | 'reset', advanceTo?: number) => {
    setBusy(action)
    try {
      await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (advanceTo !== undefined) setStep(advanceTo)
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <Chrome state={state} />

      {error && (
        <div className="px-8 py-3 font-mono text-[11px] text-bound border-b border-line">
          {error}
        </div>
      )}

      <Hero state={state} />
      <JudgePath />

      <div className="px-8 pb-6">
        <div className="border border-dashed border-line rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(state?.viewers ?? []).map((v) => (
              <ViewerCard
                key={v.key}
                viewer={v}
                rules={state?.rules ?? []}
                limits={state?.limits}
                firing={firing}
                onPlaced={load}
                explorer={state?.proof.explorer}
              />
            ))}
            {!state && <Placeholder />}
          </div>
        </div>

        <Sequence step={step} busy={busy} run={run} />
      </div>

      <Proofs state={state} />
      <Tape rows={state?.tape ?? []} explorer={state?.proof.explorer} />
    </main>
  )
}

function Chrome({ state }: { state: State | null }) {
  return (
    <header className="h-14 bg-indigo text-on-indigo flex items-center px-8 gap-4 shrink-0">
      {/* The lockup carries the wordmark, so there is no separate "Venue" text beside it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/venue-lockup.png" alt="Venue" className="h-[26px] w-auto shrink-0" />
      <div className="font-mono text-[11px] opacity-80 ml-6">
        {state ? (
          <AddressLink
            address={state.asset.address}
            explorer={state.proof.explorer}
            label={`${state.asset.symbol} · ${state.asset.name}`}
            onField
          />
        ) : (
          '-'
        )}
      </div>
      <div className="ml-auto flex items-center gap-4 font-mono text-[11px]">
        <span className="opacity-80">
          <span className="opacity-70">●</span> {state?.proof.network ?? 'connecting'}
          {state ? ` · ${state.proof.chainId}` : ''}
        </span>
        <span className="opacity-60">[/]</span>
      </div>
    </header>
  )
}

/**
 * The thesis, stated before anything else.
 *
 * A judge arriving cold sees three panes of numbers and no reason to care. One headline and
 * two sentences of prose is the difference between "an order book" and "the order book is
 * the compliance control".
 */
function Hero({ state }: { state: State | null }) {
  return (
    <section className="px-8 pt-8 pb-6">
      <h1 className="font-ui font-bold text-indigo tracking-[-0.035em] text-[34px] leading-[1.1] max-w-[900px]">
        Eligibility shapes the book. It does not gate the transfer.
      </h1>
      <p className="mt-3 max-w-[760px] text-[14px] leading-[1.55] text-body">
        Every other compliant-RWA venue lets anyone place an order and reverts at settlement.
        Venue projects the book against each viewer&rsquo;s verified identity, so an
        ineligible pair is never formed. One asset, one instant, three credentials, and three
        different books.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-muted">
        <span>
          rule <span className="text-indigo">{state?.proof.ruleSummary ?? '-'}</span>
        </span>
        <span>
          holders{' '}
          <span className="text-indigo">
            {state ? `${state.limits.holderCount}/${state.limits.maxHolders}` : '-'}
          </span>
        </span>
        <span>
          projection <span className="text-indigo">{state ? `${state.latencyMs}ms` : '-'}</span>
        </span>
        <span>
          reverts <span className="text-indigo">0</span>
        </span>
      </div>
    </section>
  )
}


function JudgePath() {
  const proofLinks = [
    ['summary', '/summary', 'rubric-first one-page artifact'],
    ['health', '/api/health', 'live Monad, CVI, contracts and cash-leg proof'],
    ['state', '/api/state', 'raw per-viewer projected books'],
    ['ledger', '/api/ledger', 'settlements rechecked by receipt'],
    ['llms', '/llms.txt', 'plain-text agent brief'],
    ['source', 'https://github.com/brutaldevvin/venue', 'public repo and commit history'],
  ]
  const rubric = ['Concept 20%', 'CVI/CVA depth 30%', 'Build quality 25%', 'UX/demo 15%', 'Scalability 10%']
  return (
    <section className="px-8 pb-6">
      <div className="border border-line bg-card rounded-lg p-4 grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-5">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            for judges and agents
          </div>
          <p className="mt-2 text-[14px] leading-[1.6] text-body max-w-[760px]">
            Start with the live proof, then run the two demo beats. The app is designed to be
            readable without trust in screenshots: health proves the dependencies, state exposes
            the projected books as JSON, and the ledger rechecks settlement receipts.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {rubric.map((r) => (
              <span
                key={r}
                className="font-mono text-[10px] uppercase tracking-[0.04em] px-2 h-[22px] rounded-sm border border-line bg-ground text-muted flex items-center"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {proofLinks.map(([label, href, note]) => (
            <a
              key={href}
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noreferrer' : undefined}
              className="border border-dashed border-line rounded-md p-3 hover:bg-ground"
            >
              <div className="font-mono text-[11px] uppercase tracking-[0.04em] text-indigo">
                /{label}
              </div>
              <div className="mt-1 font-mono text-[10px] leading-[1.45] text-muted">{note}</div>
            </a>
          ))}
        </div>
      </div>
    </section>
  )
}

/** One guided path, numbered, rather than three equal buttons a judge must decode. */
function Sequence({
  step,
  busy,
  run,
}: {
  step: number
  busy: string | null
  run: (a: 'match' | 'lapse' | 'cross' | 'reset', advanceTo?: number) => void
}) {
  const steps = [
    {
      n: 1,
      label: 'two bids cross',
      action: 'cross' as const,
      to: 1,
      caption: 'the better bid is passed over, the cap binds',
    },
    {
      n: 2,
      label: 'a credential lapses',
      action: 'lapse' as const,
      to: 2,
      caption: 'the watcher pulls that maker’s orders',
    },
  ]
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {steps.map((s) => (
        <button
          key={s.n}
          onClick={() => run(s.action, s.to)}
          disabled={busy !== null}
          title={s.caption}
          className={`font-mono text-[11px] uppercase tracking-[0.04em] px-3 h-[30px] rounded-sm disabled:opacity-40 ${
            step < s.to
              ? 'bg-indigo text-on-indigo hover:bg-indigo-deep'
              : 'border border-line text-body hover:bg-ground'
          }`}
        >
          {s.n}. {busy === s.action ? 'running…' : s.label}
        </button>
      ))}
      <button
        onClick={() => run('match')}
        disabled={busy !== null}
        className="font-mono text-[11px] uppercase tracking-[0.04em] px-3 h-[30px] rounded-sm border border-line text-body hover:bg-ground disabled:opacity-40"
      >
        run matcher
      </button>
      <button
        onClick={() => run('reset', 0)}
        disabled={busy !== null}
        className="font-mono text-[11px] uppercase tracking-[0.04em] px-3 h-[30px] rounded-sm border border-line text-muted hover:bg-ground disabled:opacity-40"
      >
        {busy === 'reset' ? 'restoring…' : 'reset'}
      </button>
      <span className="font-mono text-[11px] text-muted ml-auto">
        {steps.find((s) => s.to === step)?.caption ?? 'three credentials, one asset'}
      </span>
    </div>
  )
}

function Placeholder() {
  return (
    <div className="col-span-3 font-mono text-[11px] text-muted py-12 text-center">
      reading the book from monad testnet…
    </div>
  )
}

function Chip({
  label,
  value,
  bound,
  firing,
}: {
  label: string
  value: string
  bound?: boolean
  firing?: boolean
}) {
  return (
    <div
      className={`h-[22px] px-2 rounded-sm border flex items-center gap-1.5 bg-ground ${
        bound ? 'border-bound' : 'border-line'
      } ${firing ? 'flash-bound' : ''}`}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-muted">{label}</span>
      <span className={`font-mono text-[11px] ${bound ? 'text-bound' : 'text-indigo'}`}>
        {value}
      </span>
    </div>
  )
}

function ViewerCard({
  viewer,
  rules,
  limits,
  firing,
  onPlaced,
  explorer,
}: {
  viewer: ViewerView
  rules: Rule[]
  limits?: State['limits']
  firing: Set<string>
  onPlaced: () => void
  explorer?: string
}) {
  const rule = rules[0]
  const boundReasons = new Set(viewer.bound.map((b) => b.reason))
  const ruleBinds = viewer.refusal?.reason === 'rule-set'
  const capBinds = boundReasons.has('holder-cap')
  const fires = (reason: string) => firing.has(`${viewer.key}:${reason}`)
  const eligible = viewer.refusal === null

  return (
    <section className="bg-card border border-line rounded-lg p-5 flex flex-col min-h-[440px]">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted">
          [{viewer.key}] VIEWER
        </div>
        <div className="font-mono text-[10px]">
          <AddressLink address={viewer.address} explorer={explorer} />
        </div>
      </div>
      <div className="font-mono text-[12px] text-body mt-1">{viewer.label}</div>

      <div className="flex flex-wrap gap-1.5 mt-4">
        <Chip
          label="sub-tier"
          value={viewer.credential ? String(viewer.credential.subTier) : '-'}
          bound={ruleBinds}
          firing={fires('rule-set')}
        />
        <Chip
          label="req"
          value={rule ? `>= ${rule.minSubTier}` : '-'}
          bound={ruleBinds}
          firing={fires('rule-set')}
        />
        <Chip
          label="cap"
          value={limits ? `${limits.holderCount}/${limits.maxHolders}` : '-'}
          bound={capBinds}
          firing={fires('holder-cap')}
        />
        <Chip label="lockup" value="none" />
        <Chip
          label="pos"
          value={viewer.credential ? 'ok' : '-'}
          bound={boundReasons.has('position-limit')}
          firing={fires('position-limit')}
        />
      </div>

      <div className="mt-5 flex-1">
        {viewer.visible.length > 0 ? (
          <Ladder orders={viewer.visible} />
        ) : (
          <EmptyBook viewer={viewer} rule={rule} />
        )}
      </div>

      {eligible && <Ticket viewer={viewer.key} onPlaced={onPlaced} />}
    </section>
  )
}

function Ticket({ viewer, onPlaced }: { viewer: string; onPlaced: () => void }) {
  const [side, setSide] = useState<'bid' | 'ask'>('bid')
  const [price, setPrice] = useState('10150')
  const [qty, setQty] = useState('50')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const place = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ viewer, side, price, qty }),
      })
      const json = await res.json()
      if (!json.ok) setErr(json.reason ?? 'rejected')
      else onPlaced()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const notional = (() => {
    try {
      return (BigInt(price) * BigInt(qty)).toString()
    } catch {
      return '-'
    }
  })()

  return (
    <div className="mt-4 pt-4 border-t border-line">
      <div className="flex gap-1.5 mb-2">
        {(['bid', 'ask'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`h-[22px] px-2 rounded-sm font-mono text-[11px] border ${
              side === s ? 'border-indigo text-indigo' : 'border-line text-muted'
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <label className="flex-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-muted">price</span>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full h-[26px] px-1.5 bg-ground border border-line rounded-sm font-mono text-[12px] text-indigo outline-none focus:border-indigo"
          />
        </label>
        <label className="flex-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.04em] text-muted">size</span>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="w-full h-[26px] px-1.5 bg-ground border border-line rounded-sm font-mono text-[12px] text-indigo outline-none focus:border-indigo"
          />
        </label>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-muted mt-2">
        est. fill {notional}
      </div>
      <button
        onClick={place}
        disabled={busy}
        className="mt-2 w-full h-[30px] rounded-sm bg-indigo text-on-indigo font-mono text-[11px] uppercase tracking-[0.04em] hover:bg-indigo-deep disabled:bg-ground disabled:text-muted"
      >
        place order
      </button>
      {err && <div className="font-mono text-[10px] text-bound mt-1.5">{err}</div>}
    </div>
  )
}

/** Bids below, asks above, a hairline at mid-market. Counterparty identity is never shown. */
function Ladder({ orders }: { orders: Order[] }) {
  const asks = orders
    .filter((o) => o.side === 'ask')
    .sort((a, b) => Number(BigInt(b.price) - BigInt(a.price)))
  const bids = orders
    .filter((o) => o.side === 'bid')
    .sort((a, b) => Number(BigInt(b.price) - BigInt(a.price)))
  const max = orders.reduce((m, o) => (BigInt(o.qty) > m ? BigInt(o.qty) : m), 1n)

  return (
    <div>
      <div className="flex items-center justify-between px-1.5 pb-1 font-mono text-[10px] uppercase tracking-[0.04em] text-muted">
        <span>size</span>
        <span>price</span>
      </div>
      {asks.length === 0 && (
        <div className="px-1.5 h-[26px] flex items-center font-mono text-[11px] text-muted">
          no asks
        </div>
      )}
      {asks.map((o) => (
        <Row key={o.id} order={o} max={max} />
      ))}
      <div className="h-px bg-line my-1" />
      {bids.length === 0 && (
        <div className="px-1.5 h-[26px] flex items-center font-mono text-[11px] text-muted">
          no bids
        </div>
      )}
      {bids.map((o) => (
        <Row key={o.id} order={o} max={max} />
      ))}
    </div>
  )
}

function Row({ order, max }: { order: Order; max: bigint }) {
  const pct = Number((BigInt(order.qty) * 100n) / max)
  return (
    <div className="relative h-[26px] flex items-center justify-between px-1.5 hover:bg-ground">
      <div
        className="absolute inset-y-0 left-0 bg-indigo/[0.06] pointer-events-none"
        style={{ width: `${pct}%` }}
      />
      <span className="font-mono text-[12px] text-body relative">{order.qty}</span>
      <span className="font-mono text-[12px] text-indigo relative">{order.price}</span>
    </div>
  )
}

function EmptyBook({ viewer, rule }: { viewer: ViewerView; rule?: Rule }) {
  const unverified = viewer.refusal?.reason === 'no-credential'
  return (
    <div className="border border-dashed border-line rounded-md p-4 h-full flex flex-col justify-center gap-1">
      <div className="font-mono text-[12px] text-muted">no eligible liquidity</div>
      <div className="font-mono text-[12px] text-muted">
        {unverified ? 'no verified identity' : 'credential does not satisfy rule set'}
      </div>
      {!unverified && viewer.credential && rule && (
        <div className="font-mono text-[12px] text-muted">
          sub-tier {viewer.credential.subTier} · required &gt;= {rule.minSubTier}
        </div>
      )}
      {unverified && viewer.verifyLink && (
        <a
          href={viewer.verifyLink}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[12px] text-indigo mt-1 hover:underline"
        >
          Get verified →
        </a>
      )}
    </div>
  )
}

/**
 * The "don't take our word for it" block: every address the demo runs against, linked
 * to the explorer. The MockPolicy note is deliberate - claiming the real CCP address while
 * running against our own would be the one failure that outlives the leaderboard.
 */
function Proofs({ state }: { state: State | null }) {
  if (!state) return null
  const p = state.proof
  const rows: [string, string, string?][] = [
    ['security (CVA)', p.security],
    ['cash: Cleanverse aUSDC', p.cash],
    ['settlement', p.settlement],
    ['policy (enforces live CVI)', p.policy],
    ['Cleanverse validator', p.ccpPolicy, 'rules read from here'],
  ]
  return (
    <section className="px-8 pb-8">
      <h2 className="font-ui font-bold text-indigo tracking-[-0.035em] text-[20px]">
        Don&rsquo;t take our word for it.
      </h2>
      <div className="mt-3 border border-dashed border-line rounded-lg p-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
        {rows.map(([label, addr, note]) => (
          <div key={label} className="flex items-center gap-3 font-mono text-[11px]">
            <span className="text-muted w-[110px] shrink-0">{label}</span>
            <AddressLink address={addr} explorer={p.explorer} />
            {note && <span className="text-muted">{note}</span>}
          </div>
        ))}
      </div>
      <div className="mt-3 font-mono text-[11px] text-muted">
        check it directly:{' '}
        <a href="/api/health" target="_blank" rel="noreferrer" className="text-indigo hover:underline">
          /api/health
        </a>
        {' · '}
        <a href="/api/state" target="_blank" rel="noreferrer" className="text-indigo hover:underline">
          /api/state
        </a>
        {' · '}
        <a
          href="https://github.com/brutaldevvin/venue"
          target="_blank"
          rel="noreferrer"
          className="text-indigo hover:underline"
        >
          source
        </a>
        <span className="ml-2">
          health reports the live Monad block, the registry read for all three identities, and
          that the cash leg is Cleanverse aUSDC.
        </span>
      </div>

      <p className="mt-3 max-w-[760px] font-mono text-[11px] leading-[1.6] text-muted">
        Credentials are real A-Passes, read live from the Cleanverse registry, and the cash leg
        is Cleanverse aUSDC itself, which enforces CVI on transfer. The token gates against our
        own instance of the documented IATokenPolicy for one reason: the Cleanverse validator
        does not expose canTransfer. Extracting all 98 selectors from its implementation shows
        getRulesV2 present and canTransfer absent, and a live registered CVA confirms the
        address by returning it from validator(). That instance enforces the tier and sub-tier
        the registry actually holds for each wallet, mirrored on every reset, and the policy is
        a constructor argument, so the same bytecode repoints the day canTransfer appears.
      </p>
    </section>
  )
}

function Tape({ rows, explorer }: { rows: TapeRow[]; explorer?: string }) {
  const [open, setOpen] = useState(true)
  return (
    <footer className={`bg-indigo text-on-indigo px-8 py-4 mt-auto ${open ? 'min-h-[180px]' : ''}`}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.04em] opacity-70 mb-3 hover:opacity-100"
      >
        <span>
          Tape{rows.length > 0 ? ` · ${rows.length} events` : ''}
        </span>
        <span {...SYM}>[{open ? '⌄' : '⌃'}]</span>
      </button>
      {open && rows.length === 0 && (
        <div className="font-mono text-[11px] opacity-50">
          nothing settled yet, press <span className="opacity-90">1. two bids cross</span>
        </div>
      )}
      {/* Scrolls rather than grows: the tape carries every settlement the venue has ever
          made, so it has to stay a fixed band at the foot of the page. */}
      <div
        className={`space-y-1 max-h-[220px] overflow-y-auto pr-2 ${open ? '' : 'hidden'}`}
      >
        {rows.map((r, i) => (
          <div
            key={`${r.at}-${i}`}
            className={`row-in font-mono text-[11px] flex items-center gap-3 ${
              r.kind === 'skipped'
                ? 'border-l-2 border-bound pl-2'
                : r.kind === 'lapse'
                  ? 'opacity-70'
                  : r.kind === 'refusal'
                    ? 'opacity-55'
                    : ''
            }`}
          >
            <span className="opacity-60 w-[52px]">
              {new Date(r.at).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className="w-[64px] opacity-70">
              {r.kind === 'lapse' && (
                <span {...SYM} className="mr-1">
                  ↺
                </span>
              )}
              {r.kind}
            </span>
            <span>{r.text}</span>
            {r.rule && (
              <span className={r.kind === 'skipped' ? 'text-bound' : 'opacity-60'}>{r.rule}</span>
            )}
            {r.travelRule?.map((l) => (
              <span key={l.leg} className="opacity-60">
                TR/{l.leg} {l.reference ?? l.unavailable?.replace(/^\[|\].*$/g, '') ?? 'n/a'}
              </span>
            ))}
            {r.txHash && explorer && (
              <a
                href={`${explorer}/tx/${r.txHash}`}
                target="_blank"
                rel="noreferrer"
                className="ml-auto underline opacity-70 hover:opacity-100"
              >
                {r.txHash.slice(0, 10)}…
              </a>
            )}
          </div>
        ))}
      </div>
    </footer>
  )
}
