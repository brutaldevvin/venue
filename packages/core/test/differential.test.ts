import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address as VAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runMatcher } from '../src/match'
import type { BookState } from '../src/project'
import type { Address, Credential, Order, RuleV2, ViewerState } from '../src/types'

/**
 * The differential test: no pair the matcher forms is refused on-chain.
 *
 * The other tests in this package check the matcher against a model. This one checks it
 * against the chain. The matcher runs in TypeScript, consults a real deployed policy over
 * eth_call, and every pair it forms is then actually settled. A pair that the matcher
 * accepts and the chain rejects would be a reverted settlement, which is the exact failure
 * the whole design exists to make impossible.
 *
 * It runs against anvil rather than a testnet so it is deterministic, free and repeatable.
 * The contracts are the same ones deployed to Monad, built by `forge build`.
 *
 * MockPolicy is put in strictMode throughout, because the deployed policy refuses by
 * reverting rather than returning false. Testing against the lenient path would prove
 * nothing about production behaviour.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PORT = 8555
const RPC = `http://127.0.0.1:${PORT}`

const anvilChain = defineChain({
  id: 31337,
  name: 'anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

/** Anvil's deterministic accounts. */
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
] as const

function artifact(name: string) {
  const p = join(ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`)
  const j = JSON.parse(readFileSync(p, 'utf8'))
  return { abi: j.abi as never[], bytecode: j.bytecode.object as `0x${string}` }
}

const pub = createPublicClient({ chain: anvilChain, transport: http(RPC) })
const owner = privateKeyToAccount(KEYS[0])
const wallet = createWalletClient({ account: owner, chain: anvilChain, transport: http(RPC) })

let anvil: ChildProcess
let policy: VAddress
let security: VAddress
let cash: VAddress
let settlement: VAddress

const GROUP = '0x4344' as const
const ZERO2 = '0x0000' as const

async function deploy(name: string, args: unknown[]): Promise<VAddress> {
  const { abi, bytecode } = artifact(name)
  const hash = await wallet.deployContract({ abi, bytecode, args } as never)
  const r = await pub.waitForTransactionReceipt({ hash })
  return r.contractAddress as VAddress
}

async function send(address: VAddress, name: string, fn: string, args: unknown[]) {
  const hash = await wallet.writeContract({
    address,
    abi: artifact(name).abi,
    functionName: fn,
    args,
  } as never)
  return pub.waitForTransactionReceipt({ hash })
}

/**
 * The compliance oracle the matcher consults: a real eth_call to the deployed policy,
 * wrapped in try/catch because a refusal arrives as a revert.
 */
async function canTransferOnChain(from: string, to: string, amount: bigint): Promise<boolean> {
  try {
    return (await pub.readContract({
      address: policy,
      abi: artifact('MockPolicy').abi,
      functionName: 'canTransfer',
      args: [security, from, to, amount],
    })) as boolean
  } catch {
    return false
  }
}

beforeAll(async () => {
  anvil = spawn('anvil', ['--port', String(PORT), '--silent'], {
    stdio: 'ignore',
    env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` },
  })
  for (let i = 0; i < 60; i++) {
    try {
      await pub.getBlockNumber()
      break
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  policy = await deploy('MockPolicy', [])
  // Deliberately tight. With a cap of four and nine parties, the matcher has to pass over
  // bids from non-holders, which is the refusal path the demo turns on. A cap that never
  // binds would leave that branch untested.
  security = await deploy('Listed', ['Security', 'SEC', policy, 4n, owner.address])
  cash = await deploy('Listed', ['Cash', 'CASH', policy, (1n << 255n) - 1n, owner.address])
  settlement = await deploy('Settlement', [security, cash, owner.address, owner.address])

  // Refuse by reverting, exactly as the deployed policy does.
  await send(policy, 'MockPolicy', 'setStrictMode', [true])
}, 120_000)

afterAll(() => {
  anvil?.kill()
})

describe('differential: the matcher never forms a pair the chain refuses', () => {
  it('settles every formed pair against real contracts', async () => {
    const parties = KEYS.slice(1).map((k) => privateKeyToAccount(k))
    let formed = 0
    let settled = 0
    let skipped = 0
    let checkedRefusals = 0
    const scenarios = 24

    for (let s = 0; s < scenarios; s++) {
      // A rule set that varies across scenarios, so eligibility genuinely differs.
      const minSubTier = [0, 25, 50, 70, 90][s % 5] as number
      await send(policy, 'MockPolicy', 'setRuleV2', [
        security,
        {
          allowedGroup: ZERO2,
          allowedSubGroup: ZERO2,
          minTier: 0,
          minSubTier,
          isBlackList: false,
          countryBitmap: 0n,
        },
      ])
      await send(policy, 'MockPolicy', 'setRuleV2', [
        cash,
        {
          allowedGroup: ZERO2,
          allowedSubGroup: ZERO2,
          minTier: 0,
          minSubTier: 0,
          isBlackList: false,
          countryBitmap: 0n,
        },
      ])

      // Credentials spread around the threshold so some parties pass and some do not.
      const creds = new Map<Address, Credential | null>()
      const states = new Map<Address, ViewerState>()
      for (const [i, p] of parties.entries()) {
        const subTier = (s * 17 + i * 23) % 100
        await send(policy, 'MockPolicy', 'setCredential', [
          p.address,
          ZERO2,
          GROUP,
          50,
          subTier,
          0n,
        ])
        creds.set(p.address as Address, {
          address: p.address as Address,
          group: ZERO2,
          subGroup: GROUP,
          tier: 50,
          subTier,
          countries: [],
          status: 1,
          expirationTime: 2_000_000_000,
        })
      }

      // Fund and approve only the parties the rule currently admits, since a mint to an
      // ineligible wallet is itself refused.
      for (const p of parties) {
        const ok = await canTransferOnChain(
          '0x0000000000000000000000000000000000000000',
          p.address,
          1n,
        )
        if (ok) {
          try {
            await send(security, 'Listed', 'mint', [p.address, 1_000n])
          } catch {
            /* holder cap reached; the matcher must respect that too */
          }
        }
        await send(cash, 'Listed', 'mint', [p.address, 10_000_000n])
        const w = createWalletClient({ account: p, chain: anvilChain, transport: http(RPC) })
        for (const t of [security, cash]) {
          const h = await w.writeContract({
            address: t,
            abi: artifact('Listed').abi,
            functionName: 'approve',
            args: [settlement, (1n << 255n) - 1n],
          } as never)
          await pub.waitForTransactionReceipt({ hash: h })
        }
        const [bal, allow, cashBal, cashAllow] = await Promise.all([
          pub.readContract({
            address: security,
            abi: artifact('Listed').abi,
            functionName: 'balanceOf',
            args: [p.address],
          }) as Promise<bigint>,
          pub.readContract({
            address: security,
            abi: artifact('Listed').abi,
            functionName: 'allowance',
            args: [p.address, settlement],
          }) as Promise<bigint>,
          pub.readContract({
            address: cash,
            abi: artifact('Listed').abi,
            functionName: 'balanceOf',
            args: [p.address],
          }) as Promise<bigint>,
          pub.readContract({
            address: cash,
            abi: artifact('Listed').abi,
            functionName: 'allowance',
            args: [p.address, settlement],
          }) as Promise<bigint>,
        ])
        states.set(p.address as Address, {
          position: bal,
          allowance: allow,
          cashBalance: cashBal,
          cashAllowance: cashAllow,
        })
      }

      const [holderCount, maxHolders] = await Promise.all([
        pub.readContract({
          address: security,
          abi: artifact('Listed').abi,
          functionName: 'holderCount',
          args: [],
        }) as Promise<bigint>,
        pub.readContract({
          address: security,
          abi: artifact('Listed').abi,
          functionName: 'maxHolders',
          args: [],
        }) as Promise<bigint>,
      ])

      const orders: Order[] = parties.map((p, i) => ({
        id: `s${s}-o${i}`,
        asset: security as Address,
        maker: p.address as Address,
        side: i % 2 === 0 ? 'ask' : 'bid',
        price: BigInt(98 + ((s * 3 + i * 2) % 7)),
        qty: 10n,
        expiry: 2_000_000_000,
        nonce: BigInt(i),
        signature: '0x00',
      }))

      const book: BookState = {
        asset: security as Address,
        orders,
        makerCredentials: creds,
        makerStates: states,
        rules: [
          {
            allowedGroup: ZERO2,
            allowedSubGroup: ZERO2,
            minTier: 0,
            minSubTier,
            isBlackList: false,
            countryBitmap: 0n,
          } as RuleV2,
        ],
        limits: {
          lockupUntil: 0,
          maxHolders: Number(maxHolders),
          holderCount: Number(holderCount),
          positionLimit: 0n,
        },
        now: 1_800_000_000,
      }

      const run = await runMatcher(book, canTransferOnChain)
      formed += run.matches.length
      skipped += run.skips.length

      // The converse, for refusals the matcher attributes to the rule set: the chain must
      // agree. A pair skipped for a compliance reason that the chain would have allowed
      // would mean the matcher is inventing refusals.
      for (const sk of run.skips) {
        if (sk.reason !== 'rule-set') continue
        const ask = orders.find((o) => o.id === sk.againstOrderId)
        if (!ask) continue
        const allowed = await canTransferOnChain(ask.maker, sk.order.maker, sk.order.qty)
        expect(allowed).toBe(false)
        checkedRefusals++
      }

      // The assertion that matters: every pair the matcher formed settles on chain.
      for (const m of run.matches) {
        const notional = m.price * m.qty
        const receipt = await send(settlement, 'Settlement', 'settle', [
          {
            id: `0x${'11'.repeat(32)}` as `0x${string}`,
            seller: m.ask.maker,
            buyer: m.bid.maker,
            qty: m.qty,
            notional,
          },
        ])
        expect(receipt.status).toBe('success')
        settled++
      }
    }

    console.log(
      `differential: ${scenarios} scenarios, ${formed} pairs formed, ${settled} settled on chain, ` +
        `${skipped} refused off chain, ${checkedRefusals} rule-set refusals confirmed against the chain`,
    )
    expect(formed).toBeGreaterThan(0)
    expect(settled).toBe(formed)
  }, 300_000)
})
