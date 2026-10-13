'use client'

import { useCallback, useEffect, useState } from 'react'
import { Mark } from './mark'

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
}
interface Rule {
  minTier: number
  minSubTier: number
  allowedGroup: string
  allowedSubGroup: string
}
interface State {
  asset: { address: string; symbol: string; name: string }
  rules: Rule[]
  limits: { maxHolders: number; holderCount: number; positionLimit: string; lockupUntil: number }
  viewers: ViewerView[]
  tape: TapeRow[]
  latencyMs: number
}

const EXPLORER = 'https://testnet.monadexplorer.com/tx/'

export default function Page() {
  const [state, setState] = useState<State | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/state', { cache: 'no-store' })
      const json = await res.json()
      if (json.error) setError(json.error)
      else {
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

  const run = async (action: 'match' | 'lapse' | 'cross') => {
    setBusy(true)
    try {
      await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      await load()
    } finally {
      setBusy(false)
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

      <div className="flex-1 px-8 py-6">
        <div className="border border-dashed border-line rounded-lg p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(state?.viewers ?? []).map((v) => (
              <ViewerCard key={v.key} viewer={v} rules={state?.rules ?? []} limits={state?.limits} />
            ))}
            {!state && <Placeholder />}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => run('cross')}
            disabled={busy}
            className="font-mono text-[11px] uppercase tracking-[0.04em] px-3 h-[30px] rounded-sm bg-indigo text-on-indigo hover:bg-indigo-deep disabled:opacity-40"
          >
            two bids cross
          </button>
          <button
            onClick={() => run('match')}
            disabled={busy}
            className="font-mono text-[11px] uppercase tracking-[0.04em] px-3 h-[30px] rounded-sm border border-line text-body hover:bg-ground disabled:opacity-40"
          >
            run matcher
          </button>
          <button
            onClick={() => run('lapse')}
            disabled={busy}
            className="font-mono text-[11px] uppercase tracking-[0.04em] px-3 h-[30px] rounded-sm border border-line text-body hover:bg-ground disabled:opacity-40"
          >
            lapse a credential
          </button>
          {state && (
            <span className="font-mono text-[11px] text-muted ml-auto">
              projection {state.latencyMs}ms · holders {state.limits.holderCount}/
              {state.limits.maxHolders}
            </span>
          )}
        </div>
      </div>

      <Tape rows={state?.tape ?? []} />
    </main>
  )
}

function Chrome({ state }: { state: State | null }) {
  return (
    <header className="h-14 bg-indigo text-on-indigo flex items-center px-8 gap-4">
      <div className="flex items-center gap-4">
        <Mark size={22} />
        <span className="font-ui font-bold tracking-[-0.038em] text-[17px]">Venue</span>
      </div>
      <div className="font-mono text-[11px] opacity-80 ml-6">
        {state ? `${state.asset.symbol} · ${state.asset.name}` : '—'}
      </div>
      <div className="ml-auto font-mono text-[11px] opacity-60">[/]</div>
    </header>
  )
}

function Placeholder() {
  return (
    <div className="col-span-3 font-mono text-[11px] text-muted py-12 text-center">
      reading the book from monad testnet…
    </div>
  )
}

/**
 * The rule strip. Satisfied chips are quiet; a chip that binds goes coral, and coral is the
 * only warm colour in the product.
 */
function Chip({ label, value, bound }: { label: string; value: string; bound?: boolean }) {
  return (
    <div
      className={`h-[22px] px-2 rounded-sm border flex items-center gap-1.5 ${
        bound ? 'border-bound flash-bound' : 'border-line'
      } bg-ground`}
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
}: {
  viewer: ViewerView
  rules: Rule[]
  limits?: State['limits']
}) {
  const rule = rules[0]
  const boundReasons = new Set(viewer.bound.map((b) => b.reason))
  const ruleBinds = viewer.refusal?.reason === 'rule-set'
  const capBinds = boundReasons.has('holder-cap')

  return (
    <section className="bg-card border border-line rounded-lg p-5 flex flex-col min-h-[420px]">
      <div className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted">
        [{viewer.key}] VIEWER
      </div>
      <div className="font-mono text-[12px] text-body mt-1">{viewer.label}</div>

      <div className="flex flex-wrap gap-1.5 mt-4">
        <Chip
          label="sub-tier"
          value={viewer.credential ? String(viewer.credential.subTier) : '—'}
          bound={ruleBinds}
        />
        <Chip label="req" value={rule ? `>= ${rule.minSubTier}` : '—'} bound={ruleBinds} />
        <Chip
          label="cap"
          value={limits ? `${limits.holderCount}/${limits.maxHolders}` : '—'}
          bound={capBinds}
        />
        <Chip label="lockup" value="none" />
        <Chip label="pos" value={viewer.credential ? 'ok' : '—'} />
      </div>

      <div className="mt-5 flex-1">
        {viewer.visible.length > 0 ? (
          <Ladder orders={viewer.visible} />
        ) : (
          <EmptyBook viewer={viewer} rule={rule} />
        )}
      </div>
    </section>
  )
}

/**
 * The empty book. A dashed container means a defined region that is currently empty, which
 * is precisely the state - it reads as deliberate rather than broken. No spinner, no
 * skeleton, no warning glyph, nothing red.
 */
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
      {asks.map((o) => (
        <Row key={o.id} order={o} max={max} />
      ))}
      <div className="h-px bg-line my-1" />
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

/**
 * The tape is an indigo field rather than a card because coral is unmissable on indigo, and
 * the skipped row is the demo's money shot.
 */
function Tape({ rows }: { rows: TapeRow[] }) {
  return (
    <footer className="bg-indigo text-on-indigo px-8 py-4 min-h-[180px]">
      <div className="font-mono text-[11px] uppercase tracking-[0.04em] opacity-70 mb-3">Tape</div>
      {rows.length === 0 && (
        <div className="font-mono text-[11px] opacity-50">nothing settled yet</div>
      )}
      <div className="space-y-1">
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
            <span className="w-[60px] opacity-70">
              {r.kind === 'lapse' ? '↺ lapse' : r.kind}
            </span>
            <span>{r.text}</span>
            {r.rule && (
              <span className={r.kind === 'skipped' ? 'text-bound' : 'opacity-60'}>{r.rule}</span>
            )}
            {r.txHash && (
              <a
                href={`${EXPLORER}${r.txHash}`}
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
