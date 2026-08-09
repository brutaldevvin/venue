import type { Address, BookState, Credential, Order, RuleV2, ViewerState } from '@venue/core'
import { project, runMatcher } from '@venue/core'
import { createWalletClient, http, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  addresses,
  canTransfer,
  listedAbi,
  monadTestnet,
  policyAbi,
  publicClient,
  settlementAbi,
} from './chain'
import { resolveCredential, setApassStatus, verificationLink } from './cvi'
import { signOrder, verifyOrder } from './orders'
import { agentMandate, mandateVerifier } from './mandate'
import { appendSettlement, readLedger } from './ledger'
import { travelRuleForFill } from './travelrule'
import { Watcher } from './watcher'

export interface TapeRow {
  kind: 'fill' | 'skipped' | 'lapse' | 'refusal'
  at: number
  text: string
  /** The governing rule, for a skip. This is the demo's money shot. */
  rule?: string
  txHash?: string
  /** One Travel Rule reference per leg. Fills only - a refusal owes no report. */
  travelRule?: { leg: string; reference: string | null; unavailable?: string }[]
}

export interface ViewerView {
  key: string
  label: string
  address: Address
  credential: Credential | null
  visible: Order[]
  refusal: { reason: string; constraint: string } | null
  bound: { reason: string; constraint: string }[]
  /** Where an unverified viewer is sent. Comes from the CVI API, never the contract. */
  verifyLink?: string
}

/**
 * What a judge needs to confirm this is live rather than a mockup: the network, the
 * contracts to open on the explorer, and the rule the book is actually being projected
 * against.
 */
export interface Proof {
  network: string
  chainId: number
  explorer: string
  policy: Address
  security: Address
  cash: Address
  settlement: Address
  /** The real CCP policy, for contrast - see the note the console renders beside it. */
  ccpPolicy: Address
  ruleSummary: string
}

export interface VenueState {
  proof: Proof
  asset: { address: Address; symbol: string; name: string }
  rules: RuleV2[]
  limits: { maxHolders: number; holderCount: number; positionLimit: string; lockupUntil: number }
  viewers: ViewerView[]
  tape: TapeRow[]
  latencyMs: number
}

const VIEWER_DEFS = [
  { key: 'A', label: 'verified institution', env: 'VIEWER_A_PKEY' },
  { key: 'B', label: 'verified, lower tier', env: 'W_PKEY' },
  { key: 'C', label: 'unverified', env: 'FACILITATOR_PKEY' },
] as const

/**
 * Process-wide book. REST + 1s polling, no WebSocket - it removes a whole class of bug.
 *
 * Held on `globalThis` rather than in module scope because Next compiles each route into
 * its own module graph in dev: plain module state gives `/api/run` and `/api/state` two
 * different books, and the tape silently never reaches the console.
 */
interface Store {
  tape: TapeRow[]
  orders: Order[]
  seeded: boolean
  watcher: Watcher | null
  hydrated: boolean
}
const store: Store = ((globalThis as { __venue?: Store }).__venue ??= {
  tape: [],
  orders: [],
  seeded: false,
  watcher: null,
  hydrated: false,
})

/**
 * The watcher runs for the life of the process, pulling orders whose maker's credential has
 * lapsed. Started lazily on first read so there is no separate process to run.
 */
function ensureWatching(): Watcher {
  if (store.watcher) return store.watcher
  store.watcher = new Watcher({
    orders: () => store.orders,
    resolve: (maker) => readCredential(maker),
    cancel: (maker, ids, reason) => {
      store.orders = store.orders.filter((o) => !ids.includes(o.id))
      store.tape.push({
        kind: 'lapse',
        at: Date.now(),
        text: `${ids.length} order${ids.length === 1 ? '' : 's'} withdrawn`,
        rule: reason,
      })
    },
  })
  store.watcher.start()
  return store.watcher
}

function keyFor(name: string): `0x${string}` {
  const raw = process.env[name] ?? ''
  return (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
}

/**
 * The market makers, derived rather than read from disk.
 *
 * This used to load `.venue-makers.json`, which is correctly gitignored and therefore does
 * not exist in a deployed container: the book would seed empty and the demo would render
 * three blank panes with no error. The keys are deterministic, so deriving them from the
 * same label `scripts/seed.ts` uses gives the identical addresses with no file to ship.
 *
 * These are demo wallets on a testnet holding only sandbox assets. They are derived from a
 * public label on purpose, so anyone can reproduce the book, and nothing of value depends on
 * them being secret.
 */
const MAKER_COUNT = 5

function makerKeys(): { address: Address; privateKey: `0x${string}` }[] {
  return Array.from({ length: MAKER_COUNT }, (_, i) => {
    const privateKey = keccak256(toHex(`venue-market-maker-${i}`))
    return { address: privateKeyToAccount(privateKey).address as Address, privateKey }
  })
}

function viewerAddresses(): { key: string; label: string; address: Address }[] {
  return VIEWER_DEFS.map((v) => {
    const raw = process.env[v.env] ?? ''
    const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
    return { key: v.key, label: v.label, address: privateKeyToAccount(pk).address }
  })
}

/**
 * Credentials come from the Cleanverse CVI registry.
 *
 * This used to read `getCredential` off our own policy contract, which meant the demo was
 * projecting against numbers we had invented. It now resolves the live A-Pass, so the tier
 * and sub-tier on screen are the ones Cleanverse holds for that wallet.
 */
async function readCredential(who: Address): Promise<Credential | null> {
  return resolveCredential(who)
}

/** What the gate currently holds for a wallet, so mirroring only writes on a difference. */
async function readMirroredCredential(who: Address): Promise<{ tier: number; subTier: number } | null> {
  try {
    const r = (await publicClient.readContract({
      address: addresses.policy,
      abi: [
        {
          type: 'function',
          name: 'getCredential',
          stateMutability: 'view',
          inputs: [{ name: 'holder', type: 'address' }],
          outputs: [
            { type: 'bytes2' }, { type: 'bytes2' }, { type: 'uint8' },
            { type: 'uint8' }, { type: 'uint256' }, { type: 'bool' },
          ],
        },
      ] as const,
      functionName: 'getCredential',
      args: [who],
    })) as [string, string, number, number, bigint, boolean]
    return r[5] ? { tier: r[2], subTier: r[3] } : null
  } catch {
    return null
  }
}

async function readViewerState(who: Address): Promise<ViewerState> {
  const [position, allowance, cashBalance, cashAllowance] = await Promise.all([
    publicClient.readContract({
      address: addresses.security,
      abi: listedAbi,
      functionName: 'balanceOf',
      args: [who],
    }),
    publicClient.readContract({
      address: addresses.security,
      abi: listedAbi,
      functionName: 'allowance',
      args: [who, addresses.settlement],
    }),
    publicClient.readContract({
      address: addresses.cash,
      abi: listedAbi,
      functionName: 'balanceOf',
      args: [who],
    }),
    publicClient.readContract({
      address: addresses.cash,
      abi: listedAbi,
      functionName: 'allowance',
      args: [who, addresses.settlement],
    }),
  ])
  return {
    position: position as bigint,
    allowance: allowance as bigint,
    cashBalance: cashBalance as bigint,
    cashAllowance: cashAllowance as bigint,
  }
}

/** Seed a two-sided book, signed by the market makers. */
async function seedBook(): Promise<void> {
  if (store.seeded) return
  store.seeded = true
  const keys = makerKeys()
  if (keys.length === 0) return

  const expiry = Math.floor(Date.now() / 1000) + 86_400
  // Sizes are bounded by the cash leg. aUSDC has 6 decimals and each maker holds 1.0, so a
  // bid at ~10,000 can be at most ~95 units before it is genuinely unfunded. The ladder was
  // originally sized for a cash token we minted freely; against a real asset it has to fit
  // real balances.
  const ladder: Array<['bid' | 'ask', bigint, bigint]> = [
    ['ask', 10_250n, 40n],
    ['ask', 10_200n, 25n],
    ['ask', 10_150n, 12n],
    ['bid', 10_100n, 18n],
    ['bid', 10_050n, 30n],
    ['bid', 10_000n, 50n],
  ]

  const made: Order[] = []
  for (const [i, [side, price, qty]] of ladder.entries()) {
    const k = keys[i % keys.length]!
    made.push(
      await signOrder(
        k.privateKey,
        {
          asset: addresses.security,
          maker: k.address,
          side,
          price,
          qty,
          expiry,
          nonce: BigInt(i),
        },
        addresses.settlement,
      ),
    )
  }
  store.orders = made
}

/**
 * The signature case, set up on live state: two crossing bids arrive, the better one from a
 * party who holds nothing and the worse one from an existing holder. With the cap full the
 * matcher must pass over the better bid - price-time priority violated by compliance,
 * deliberately and lawfully, because the cap is a disclosed asset term.
 */
export async function injectCrossingBids(): Promise<void> {
  // Seed first: seedBook() assigns the order list wholesale, so injecting before it runs
  // would have the resting ladder overwrite these bids on the very next call.
  await seedBook()
  const keys = makerKeys()
  if (keys.length < 5) return
  const nonHolder = keys[4]!
  const incumbent = keys[0]!
  const expiry = Math.floor(Date.now() / 1000) + 3600

  const already = new Set(store.orders.map((o) => o.id))
  for (const [k, price, nonce] of [
    [nonHolder, 10_300n, 100n],
    [incumbent, 10_200n, 101n],
  ] as const) {
    const o = await signOrder(
      k.privateKey,
      {
        asset: addresses.security,
        maker: k.address,
        side: 'bid',
        price,
        qty: 10n,
        expiry,
        nonce,
      },
      addresses.settlement,
    )
    if (!already.has(o.id)) store.orders.push(o)
  }
}

/**
 * Clear the book and the tape.
 *
 * The store lives on `globalThis` so the API routes share it, which also means it outlives
 * a hot reload - without this a demo starts with rows from whatever ran before it.
 */
/**
 * Clear the working book, but keep the settled history.
 *
 * Fills, skips and lapses are the record of what the demo has done and are the reason a
 * visitor can see it worked before they arrived. Wiping them on reset erased that, which is
 * the opposite of what the tape is for. Only the resting orders are rebuilt.
 */
export function reset(): void {
  store.orders = []
  store.tape = store.tape.filter((r) => r.kind === 'fill')
  store.seeded = false
}

/**
 * Put the chain back to its opening state and clear the book.
 *
 * Running the demo mutates real state - a lapse revokes a credential, a fill consumes
 * orders - so without this the second judge to press a button sees a half-empty book and no
 * ask side. Restoring is idempotent and cheap.
 */
export async function resetDemo(): Promise<{ restored: number }> {
  const owner = privateKeyToAccount(keyFor('W_PKEY'))
  const wallet = createWalletClient({
    account: owner,
    chain: monadTestnet,
    transport: http(process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'),
  })

  const setCredential = {
    type: 'function',
    name: 'setCredential',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'holder', type: 'address' },
      { name: 'group', type: 'bytes2' },
      { name: 'subGroup', type: 'bytes2' },
      { name: 'tier', type: 'uint8' },
      { name: 'subTier', type: 'uint8' },
      { name: 'countryBitmap', type: 'uint256' },
    ],
    outputs: [],
  } as const

  // Re-mirror from the live registry rather than from constants. Running the demo mutates
  // on-chain state, and restoring invented values here would quietly replace the real CVI
  // credentials the whole projection is supposed to be reading.
  const parties: Address[] = [
    ...viewerAddresses().map((v) => v.address),
    ...makerKeys().map((k) => k.address),
  ]

  // Reactivate anything a previous run froze, so the demo is repeatable. This is the same
  // registry call the lapse uses, in the other direction.
  let reactivated = 0
  for (const who of parties) {
    const c = await resolveCredential(who)
    if (c !== null && c.status !== 1) {
      if (await setApassStatus(who, 1)) reactivated++
    }
  }
  if (reactivated > 0) await new Promise((r) => setTimeout(r, 2000))

  let restored = 0
  for (const who of parties) {
    const live = await resolveCredential(who)
    if (live === null) continue // viewer C holds no A-Pass; that is its role
    const onChain = await readMirroredCredential(who)
    if (onChain !== null && onChain.subTier === live.subTier && onChain.tier === live.tier) continue
    const hash = await wallet.writeContract({
      address: addresses.policy,
      abi: [setCredential],
      functionName: 'setCredential',
      args: [who, live.group, live.subGroup, live.tier, live.subTier, 0n],
    })
    await publicClient.waitForTransactionReceipt({ hash })
    restored++
  }

  // Cash is a real asset now, so it drains as the demo settles. Top participants back up so
  // the book does not quietly hollow out for whoever presses reset next: an underfunded bid
  // is correctly refused, which looks like a broken demo rather than a working rule.
  const erc20 = [
    {
      type: 'function',
      name: 'balanceOf',
      stateMutability: 'view',
      inputs: [{ type: 'address' }],
      outputs: [{ type: 'uint256' }],
    },
    {
      type: 'function',
      name: 'transfer',
      stateMutability: 'nonpayable',
      inputs: [{ type: 'address' }, { type: 'uint256' }],
      outputs: [{ type: 'bool' }],
    },
  ] as const
  const FLOOR = 1_000_000n
  const ownerCash = (await publicClient.readContract({
    address: addresses.cash,
    abi: erc20,
    functionName: 'balanceOf',
    args: [owner.address],
  })) as bigint
  let spare = ownerCash > FLOOR ? ownerCash - FLOOR : 0n
  for (const who of parties) {
    if (spare === 0n) break
    // The cash leg is a real CVA and enforces compliance: sending it to a wallet with no
    // A-Pass reverts. Viewer C is exactly that wallet, and it is not a market participant,
    // so it is skipped rather than allowed to fail the whole reset.
    if ((await resolveCredential(who)) === null) continue
    const bal = (await publicClient.readContract({
      address: addresses.cash,
      abi: erc20,
      functionName: 'balanceOf',
      args: [who],
    })) as bigint
    if (bal >= FLOOR) continue
    const top = FLOOR - bal > spare ? spare : FLOOR - bal
    const h = await wallet.writeContract({
      address: addresses.cash,
      abi: erc20,
      functionName: 'transfer',
      args: [who, top],
    })
    await publicClient.waitForTransactionReceipt({ hash: h })
    spare -= top
  }

  // Clear the book only once credentials are back. The other order races the 1s poll: it
  // re-seeds against stale credentials and the watcher immediately pulls those orders, so
  // the demo restarts with a one-sided book.
  reset()
  return { restored }
}

/**
 * Place an order from the order ticket.
 *
 * Signed with the viewer's own key, so it is a genuine maker signature rather than a venue
 * assertion - the operator can still only hide orders, never invent them.
 */
export async function placeOrder(input: {
  viewer: string
  side: 'bid' | 'ask'
  price: bigint
  qty: bigint
}): Promise<{ ok: boolean; reason?: string; id?: string }> {
  await seedBook()
  const def = VIEWER_DEFS.find((v) => v.key === input.viewer)
  if (!def) return { ok: false, reason: 'unknown viewer' }
  if (input.price <= 0n || input.qty <= 0n) return { ok: false, reason: 'price and size must be positive' }

  const raw = process.env[def.env] ?? ''
  const pk = (raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`
  const maker = privateKeyToAccount(pk).address as Address

  const order = await signOrder(
    pk,
    {
      asset: addresses.security,
      maker,
      side: input.side,
      price: input.price,
      qty: input.qty,
      expiry: Math.floor(Date.now() / 1000) + 3600,
      nonce: BigInt(Date.now()),
    },
    addresses.settlement,
  )
  const res = await addOrder(order)
  return res.ok ? { ok: true, id: order.id } : res
}

export async function addOrder(o: Order): Promise<{ ok: boolean; reason?: string }> {
  // An order the venue cannot attribute is not an order. The operator may hide liquidity,
  // but must not be able to invent it.
  if (!(await verifyOrder(o, addresses.settlement))) {
    return { ok: false, reason: 'signature does not recover to maker' }
  }
  store.orders.push(o)
  return { ok: true }
}

/**
 * Fill the tape from the published ledger.
 *
 * The tape used to hold only what this process had seen, so every redeploy wiped it and a
 * visitor was told the venue had never settled anything. The settlements are published to
 * venue-data as they happen, so the history is recoverable: it is loaded once per process and
 * live events accumulate on top. Deduplicated by transaction hash, because a settlement made
 * by this process is both in the tape already and in the ledger it just wrote to.
 */
async function hydrateTape(): Promise<void> {
  if (store.hydrated) return
  store.hydrated = true
  try {
    const records = await readLedger()
    const known = new Set(store.tape.map((r) => r.txHash).filter(Boolean))
    // The ledger is newest first; the tape is oldest first and reversed for display.
    const rows: TapeRow[] = [...records]
      .reverse()
      .filter((r) => !known.has(r.txHash))
      .map((r) => ({
        kind: 'fill' as const,
        at: Date.parse(r.at) || Date.now(),
        text: `${r.qty} @ ${r.price} · both legs CVA`,
        txHash: r.txHash,
      }))
    store.tape = [...rows, ...store.tape]
  } catch {
    // A ledger fetch failure must not empty the tape or fail the page.
  }
}

export async function getState(): Promise<VenueState> {
  await seedBook()
  await hydrateTape()
  ensureWatching()
  const started = Date.now()

  const [rules, holderCount, maxHolders] = await Promise.all([
    publicClient.readContract({
      address: addresses.policy,
      abi: policyAbi,
      functionName: 'getRulesV2',
      args: [addresses.security],
    }),
    publicClient.readContract({
      address: addresses.security,
      abi: listedAbi,
      functionName: 'holderCount',
    }),
    publicClient.readContract({
      address: addresses.security,
      abi: listedAbi,
      functionName: 'maxHolders',
    }),
  ])

  const ruleList = (rules as readonly RuleV2[]).map((r) => ({
    allowedGroup: r.allowedGroup,
    allowedSubGroup: r.allowedSubGroup,
    minTier: Number(r.minTier),
    minSubTier: Number(r.minSubTier),
    isBlackList: Boolean(r.isBlackList),
    countryBitmap: BigInt(r.countryBitmap),
  }))

  const vs = viewerAddresses()
  const makers = [...new Set(store.orders.map((o) => o.maker))]
  const parties = [...new Set([...makers, ...vs.map((v) => v.address)])]

  const creds = new Map<Address, Credential | null>()
  const states = new Map<Address, ViewerState>()
  await Promise.all(
    parties.map(async (p) => {
      creds.set(p, await readCredential(p))
      states.set(p, await readViewerState(p))
    }),
  )

  const limits = {
    lockupUntil: 0,
    maxHolders: Number(maxHolders as bigint),
    holderCount: Number(holderCount as bigint),
    positionLimit: 0n,
  }

  const book: BookState = {
    asset: addresses.security,
    orders: store.orders,
    makerCredentials: creds,
    makerStates: states,
    rules: ruleList,
    limits,
    now: Math.floor(Date.now() / 1000),
  }

  // Only unverified viewers need a registry link, so only they cost a call.
  const links = new Map<Address, string | undefined>()
  await Promise.all(
    vs
      .filter((v) => (creds.get(v.address) ?? null) === null)
      .map(async (v) => links.set(v.address, await verificationLink(v.address, addresses.security))),
  )

  const viewers: ViewerView[] = vs.map((v) => {
    const cred = creds.get(v.address) ?? null
    const state = states.get(v.address) ?? { position: 0n, allowance: 0n }
    const p = project(cred, state, book)
    return {
      key: v.key,
      label: v.label,
      address: v.address,
      credential: cred,
      visible: p.visible,
      refusal: p.refusal,
      bound: p.bound,
      verifyLink: links.get(v.address),
    }
  })

  const rule0 = ruleList[0]
  return {
    proof: {
      network: 'Monad testnet',
      chainId: 10143,
      explorer: 'https://testnet.monadscan.com',
      policy: addresses.policy,
      security: addresses.security,
      cash: addresses.cash,
      settlement: addresses.settlement,
      ccpPolicy: (process.env.POLICY_ADDRESS ??
        '0xaC7e5179C2C7f03f209136886c172eb34F161792') as Address,
      ruleSummary: rule0
        ? `RuleV2(group ${rule0.allowedGroup}, subGroup ${rule0.allowedSubGroup}, minTier ${rule0.minTier}, minSubTier ${rule0.minSubTier})`
        : 'no rules - transfers as a plain ERC-20',
    },
    asset: { address: addresses.security, symbol: 'RVS', name: 'ReVault Reg S T-Bill' },
    rules: ruleList,
    limits: { ...limits, positionLimit: limits.positionLimit.toString() },
    viewers,
    tape: [...store.tape].reverse().slice(0, 100),
    latencyMs: Date.now() - started,
  }
}

/** Run the matcher and settle whatever it forms. The demo's beats 2 and 4. */
export async function runAndSettle(): Promise<{ matched: number; skipped: number }> {
  await seedBook()

  const [rules, holderCount, maxHolders] = await Promise.all([
    publicClient.readContract({
      address: addresses.policy,
      abi: policyAbi,
      functionName: 'getRulesV2',
      args: [addresses.security],
    }),
    publicClient.readContract({
      address: addresses.security,
      abi: listedAbi,
      functionName: 'holderCount',
    }),
    publicClient.readContract({
      address: addresses.security,
      abi: listedAbi,
      functionName: 'maxHolders',
    }),
  ])

  const ruleList = (rules as readonly RuleV2[]).map((r) => ({
    allowedGroup: r.allowedGroup,
    allowedSubGroup: r.allowedSubGroup,
    minTier: Number(r.minTier),
    minSubTier: Number(r.minSubTier),
    isBlackList: Boolean(r.isBlackList),
    countryBitmap: BigInt(r.countryBitmap),
  }))

  const parties = [...new Set(store.orders.map((o) => o.maker))]
  const creds = new Map<Address, Credential | null>()
  const states = new Map<Address, ViewerState>()
  await Promise.all(
    parties.map(async (p) => {
      creds.set(p, await readCredential(p))
      states.set(p, await readViewerState(p))
    }),
  )

  const book: BookState = {
    asset: addresses.security,
    orders: store.orders,
    makerCredentials: creds,
    makerStates: states,
    rules: ruleList,
    limits: {
      lockupUntil: 0,
      maxHolders: Number(maxHolders as bigint),
      holderCount: Number(holderCount as bigint),
      positionLimit: 0n,
    },
    now: Math.floor(Date.now() / 1000),
  }

  const { matches, skips } = await runMatcher(book, (from, to, amount) =>
    canTransfer(addresses.security, from, to, amount),
  )

  for (const s of skips) {
    store.tape.push({
      kind: 'skipped',
      at: Date.now(),
      text: `bid ${s.order.price} x ${s.order.qty} passed over`,
      rule: s.constraint,
    })
  }

  const raw = process.env.FACILITATOR_PKEY ?? ''
  const agent = privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`)
  const wallet = createWalletClient({
    account: agent,
    chain: monadTestnet,
    transport: http(process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'),
  })

  const signedMandate = await agentMandate()

  for (const m of matches) {
    const notional = m.price * m.qty

    // The agent verifies its principal before it moves anything. A settlement outside the
    // mandate's scope is refused here, off-chain, and moves no value - so it owes no
    // Travel Rule data either.
    const auth = await mandateVerifier.authorize(signedMandate, {
      agent: agent.address,
      venue: addresses.settlement,
      asset: addresses.security,
      qty: m.qty,
      notional,
    })
    if (!auth.ok) {
      store.tape.push({
        kind: 'refusal',
        at: Date.now(),
        text: 'settlement not authorised, no value moved',
        rule: auth.reason,
      })
      continue
    }

    // Then both parties, against the policy, in the direction the transfer will run.
    if (!(await canTransfer(addresses.security, m.ask.maker, m.bid.maker, m.qty))) {
      store.tape.push({
        kind: 'refusal',
        at: Date.now(),
        text: 'counterparty check failed at settlement, no value moved',
        rule: 'canTransfer refused',
      })
      continue
    }

    try {
      const hash = await wallet.writeContract({
        address: addresses.settlement,
        abi: settlementAbi,
        functionName: 'settle',
        args: [
          {
            id: `0x${'0'.repeat(64 - m.bid.id.slice(2).length)}${m.bid.id.slice(2)}` as `0x${string}`,
            seller: m.ask.maker,
            buyer: m.bid.maker,
            qty: m.qty,
            notional,
          },
        ],
      })
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      const legs = await travelRuleForFill(hash, m.ask.maker, m.bid.maker)

      // The ledger is an index; the chain is the evidence. Publishing must never be able to
      // fail the settlement that already happened, so it is fire-and-forget and the record
      // is held locally either way.
      void appendSettlement({
        txHash: hash,
        at: new Date(Number(receipt.blockNumber) === 0 ? Date.now() : Date.now()).toISOString(),
        qty: m.qty.toString(),
        price: m.price.toString(),
        notional: notional.toString(),
        seller: m.ask.maker,
        buyer: m.bid.maker,
        security: addresses.security,
        cash: addresses.cash,
        settlement: addresses.settlement,
        chainId: 10143,
      }).catch(() => undefined)
      store.tape.push({
        kind: 'fill',
        at: Date.now(),
        text: `${m.qty} @ ${m.price} · both legs CVA`,
        txHash: hash,
        travelRule: legs.map((l) => ({
          leg: l.leg,
          reference: l.reference,
          unavailable: l.unavailable,
        })),
      })
      store.orders = store.orders.filter((o) => o.id !== m.bid.id && o.id !== m.ask.id)
    } catch (e) {
      store.tape.push({
        kind: 'refusal',
        at: Date.now(),
        text: `settlement refused, no value moved`,
        rule: (e as Error).message.slice(0, 80),
      })
    }
  }

  return { matched: matches.length, skipped: skips.length }
}

/**
 * Beat 3: end a resting maker's eligibility at the registry.
 *
 * This only revokes the credential - it does not touch the book. Removing the orders is the
 * watcher's job, and letting it do that here is the point: the same code path runs whether
 * a credential is revoked, frozen or simply expires.
 */
export async function lapseMaker(): Promise<{
  maker: Address | null
  cancelled: number
  frozen?: boolean
}> {
  await seedBook()
  const target = store.orders.find((o) => o.side === 'ask')
  if (!target) return { maker: null, cancelled: 0 }

  // Freeze the maker's A-Pass at the registry. Credentials are resolved from CVI, so this
  // is the event the watcher actually observes; editing our own contract would no longer
  // change what the projection sees.
  const frozen = await setApassStatus(target.maker, 2)

  // A receipt does not guarantee the next eth_call sees the new state - reads can land on a
  // node that has not caught up, and the sweep then finds a live credential and cancels
  // nothing. Confirm the revocation is visible before sweeping, so the demo never silently
  // does nothing. The periodic sweep would catch it eventually either way.
  for (let i = 0; i < 20; i++) {
    const c = await readCredential(target.maker)
    if (c === null || c.status !== 1) break
    await new Promise((r) => setTimeout(r, 250))
  }

  // Sweep immediately rather than waiting for the next tick, so the demo is responsive.
  // That the watcher owns the cancellation is what makes this a watcher and not a button.
  const { cancelled } = await ensureWatching().sweep()
  return { maker: target.maker, cancelled, frozen }
}
