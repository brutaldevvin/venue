/** Simulation only. No environment/private keys, signing, or broadcasting. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { TransactionGuard } from '@baret/guard'
import { createPublicClient, encodeFunctionData, http, parseAbi } from 'viem'

const guard = new TransactionGuard({ baseUrl: 'https://baret-monad-api.onrender.com', timeoutMs: 45_000 })
const pub = createPublicClient({ transport: http('https://testnet-rpc.monad.xyz') })
const output = 'docs/baret'
mkdirSync(output, { recursive: true })
async function check(name: string, transaction: { from: `0x${string}`; to: `0x${string}`; value: string; data: `0x${string}` }) {
  const request = { network: 'testnet' as const, transaction, policyTemplate: 'balanced' as const }
  try {
    const verdict = await guard.evaluate(request)
    const result = { request, verdict }
    writeFileSync(`${output}/${name}.json`, JSON.stringify(result, null, 2) + '\n')
    console.log(name, JSON.stringify(result, null, 2))
    return verdict
  } catch (error) {
    const result = { request, error: { name: (error as Error).name, message: (error as Error).message } }
    writeFileSync(`${output}/${name}.json`, JSON.stringify(result, null, 2) + '\n')
    console.error(name, JSON.stringify(result, null, 2))
    process.exitCode = 1
  }
}

const blacklist = await check('blacklist', {
  from: '0x306707be3CD50B1Cca5E27F838AfcfC4fD84C353',
  to: '0xac9517a70c88480c9fA7E9a280DA485F7f552C29',
  value: '100000000000000000', data: '0x',
})
if (blacklist && (blacklist.decision !== 'blocked' || !blacklist.findings.some((f) => f.code === 'KNOWN_MALICIOUS_ADDRESS'))) {
  throw new Error('Blacklist did not return the expected verdict')
}

// Public deployment from EVIDENCE.md; the normal approve call in scripts/seed.ts.
const token = '0x3e4d167d6f8d14d998e9b34482be9ab22c1cb330' as const
const settlement = '0xf031a5edf0b953cd09d450f536092b68030ebcce' as const
const abi = parseAbi(['function owner() view returns (address)', 'function approve(address spender, uint256 amount) returns (bool)'])
const chainId = await pub.getChainId()
if (chainId !== 10143) throw new Error(`Wrong RPC chain: ${chainId}`)
const from = await pub.readContract({ address: token, abi, functionName: 'owner' })
await check('venue-approval', {
  from, to: token, value: '0',
  data: encodeFunctionData({ abi, functionName: 'approve', args: [settlement, (1n << 255n) - 1n] }),
})
