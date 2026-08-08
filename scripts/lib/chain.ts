import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const here = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(here, '..', '..')

export function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback
  if (v === undefined || v === '') throw new Error(`missing env: ${key}`)
  return v
}

/** Load `.env` without a dependency - the file is a flat KEY=VALUE list. */
export function loadEnv(): void {
  const text = readFileSync(join(ROOT, '.env'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    if (process.env[k] === undefined) process.env[k] = t.slice(eq + 1).trim()
  }
}

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://testnet.monadscan.com' } },
})

export function rpcUrl(): string {
  return process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'
}

export function publicClient() {
  return createPublicClient({ chain: monadTestnet, transport: http(rpcUrl()) })
}

export function account(pkeyEnv: string) {
  const raw = env(pkeyEnv)
  return privateKeyToAccount((raw.startsWith('0x') ? raw : `0x${raw}`) as `0x${string}`)
}

export function walletClient(pkeyEnv: string) {
  return createWalletClient({
    account: account(pkeyEnv),
    chain: monadTestnet,
    transport: http(rpcUrl()),
  })
}

/** Read a compiled artifact from Foundry's output. */
export function artifact(name: string): { abi: any[]; bytecode: `0x${string}` } {
  const path = join(ROOT, 'contracts', 'out', `${name}.sol`, `${name}.json`)
  const json = JSON.parse(readFileSync(path, 'utf8'))
  return { abi: json.abi, bytecode: json.bytecode.object as `0x${string}` }
}
