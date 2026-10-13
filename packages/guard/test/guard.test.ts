import { describe, expect, it, vi } from 'vitest'
import { TransactionGuard, GuardUnreachableError, type AnalyzeResponse } from '@baret/guard'
import { createWalletClient, custom, defineChain, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { guardedAccount, guardError, type Review } from '../src'
import { matchesApproval, offerApproval, takeApproval } from '../../../apps/console/lib/guard'

// Public test fixture key. Never used on a network.
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const to = '0x2222222222222222222222222222222222222222' as const
const transaction = { chainId: 10143, to, value: 12n, data: '0x' as const, gas: 21000n, gasPrice: 1n, nonce: 0 }
function verdict(decision: AnalyzeResponse['decision'] = 'safe'): AnalyzeResponse {
  return {
    decision, findings: decision === 'safe' ? [] : [{ code: 'KNOWN_MALICIOUS_ADDRESS', severity: 'critical', values: { address: to }, blocking: decision === 'blocked' }],
    firedRules: [], suggestions: [], confidence: 'high', estimatedChanges: [], approvals: [], sources: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    meta: { requestId: 'test', analysisVersion: '1', network: 'testnet', chainId: 10143, analyzedAt: new Date().toISOString(), blockNumber: '1', traced: true },
  }
}
function setup(result = verdict(), confirm?: (review: Review) => Promise<boolean>) {
  const signTransaction = vi.fn(account.signTransaction)
  const evaluate = vi.fn().mockResolvedValue(result)
  return { signTransaction, evaluate, guarded: guardedAccount({ ...account, signTransaction }, confirm, { evaluate }) }
}

describe('final signing boundary', () => {
  it('evaluates the exact public transaction fields before signing once', async () => {
    const { guarded, evaluate, signTransaction } = setup()
    await guarded.signTransaction(transaction)
    expect(evaluate).toHaveBeenCalledWith({ network: 'testnet', policyTemplate: 'balanced', transaction: {
      from: account.address, to, value: '12', data: '0x', gas: '21000', gasPrice: '1', nonce: 0,
    } })
    expect(signTransaction).toHaveBeenCalledTimes(1)
    expect(evaluate.mock.invocationCallOrder[0]).toBeLessThan(signTransaction.mock.invocationCallOrder[0]!)
  })
  it('does not sign blocked transactions even with confirmation', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const { guarded, signTransaction } = setup(verdict('blocked'), confirm)
    await expect(guarded.signTransaction(transaction)).rejects.toThrow('KNOWN_MALICIOUS_ADDRESS')
    expect(signTransaction).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })
  it('rejects contradictory safe verdicts containing a blocking finding', async () => {
    const result = verdict('blocked')
    result.decision = 'safe'
    const { guarded, signTransaction } = setup(result)
    await expect(guarded.signTransaction(transaction)).rejects.toThrow('Baret blocked:')
    expect(signTransaction).not.toHaveBeenCalled()
  })
  it.each([undefined, false, true])('caution only signs with explicit acceptance: %s', async (answer) => {
    const confirm = answer === undefined ? undefined : vi.fn().mockResolvedValue(answer)
    const { guarded, signTransaction } = setup(verdict('caution'), confirm)
    if (answer) await guarded.signTransaction(transaction)
    else await expect(guarded.signTransaction(transaction)).rejects.toThrow('Baret caution:')
    expect(signTransaction).toHaveBeenCalledTimes(answer ? 1 : 0)
  })
  it.each([new GuardUnreachableError('Baret did not answer'), new Error('bad request')])('fails closed on evaluator error', async (error) => {
    const { guarded, evaluate, signTransaction } = setup()
    evaluate.mockRejectedValue(error)
    await expect(guarded.signTransaction(transaction)).rejects.toThrow('Baret blocked:')
    expect(signTransaction).not.toHaveBeenCalled()
  })
  it('rejects unsupported signing chains before contacting Baret', async () => {
    const { guarded, evaluate, signTransaction } = setup()
    await expect(guarded.signTransaction({ ...transaction, chainId: 143 })).rejects.toThrow('unsupported chain')
    expect(evaluate).not.toHaveBeenCalled()
    expect(signTransaction).not.toHaveBeenCalled()
  })
  it.each(['expired', 'invalid date', 'wrong chain', 'wrong network'])('rejects %s verdicts', async (kind) => {
    const result = verdict()
    if (kind === 'expired') result.expiresAt = new Date(0).toISOString()
    if (kind === 'invalid date') result.expiresAt = 'not a date'
    if (kind === 'wrong chain') result.meta.chainId = 143
    if (kind === 'wrong network') result.meta.network = 'mainnet'
    const { guarded, signTransaction } = setup(result)
    await expect(guarded.signTransaction(transaction)).rejects.toThrow('expired verdict or wrong network')
    expect(signTransaction).not.toHaveBeenCalled()
  })
  it('does not sign if the verdict expires during user confirmation', async () => {
    const result = verdict('caution')
    const { guarded, signTransaction } = setup(result, async () => { result.expiresAt = new Date(0).toISOString(); return true })
    await expect(guarded.signTransaction(transaction)).rejects.toThrow('expired during confirmation')
    expect(signTransaction).not.toHaveBeenCalled()
  })
  it.each(['malformed', 'non-2xx', 'timeout'])('fails closed through the real SDK on %s responses', async (kind) => {
    const fetch = vi.fn(async () => {
      if (kind === 'timeout') throw new Error('timeout')
      return new Response(JSON.stringify({ decision: 'safe' }), { status: kind === 'non-2xx' ? 503 : 200 })
    })
    const signTransaction = vi.fn(account.signTransaction)
    const sdk = new TransactionGuard({ baseUrl: 'https://example.invalid', fetch })
    const guarded = guardedAccount({ ...account, signTransaction }, undefined, sdk)
    await expect(guarded.signTransaction(transaction)).rejects.toThrow('check unavailable')
    expect(signTransaction).not.toHaveBeenCalled()
  })
  it('checks contract creation without inventing a destination', async () => {
    const { guarded, evaluate } = setup()
    await guarded.signTransaction({ ...transaction, to: undefined, data: '0x6000' })
    expect(evaluate.mock.calls[0]![0].transaction.to).toBeNull()
    expect(evaluate.mock.calls[0]![0].transaction.data).toBe('0x6000')
  })
  it('blocks a real viem writeContract before RPC broadcast and retains the reason', async () => {
    const { guarded, evaluate, signTransaction } = setup(verdict('blocked'))
    const broadcast = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x279f'
      throw new Error(`Unexpected RPC: ${method}`)
    })
    const chain = defineChain({ id: 10143, name: 'Test', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['https://example.invalid'] } } })
    const wallet = createWalletClient({ account: guarded, chain, transport: custom({ request: broadcast }) })
    try {
      await wallet.writeContract({ address: to, abi: parseAbi(['function approve(address,uint256) returns (bool)']), functionName: 'approve', args: [to, 100n], gas: 100000n, gasPrice: 1n, nonce: 0 })
      throw new Error('Expected refusal')
    } catch (error) {
      expect(guardError(error)?.message).toContain('KNOWN_MALICIOUS_ADDRESS')
    }
    expect(evaluate).toHaveBeenCalledOnce()
    expect(evaluate.mock.calls[0]![0].transaction.data).toMatch(/^0x095ea7b3/)
    expect(signTransaction).not.toHaveBeenCalled()
    expect(broadcast.mock.calls.some(([request]) => request.method === 'eth_sendRawTransaction')).toBe(false)
  })
})

describe('console caution approval', () => {
  function review(): Review {
    return { request: { network: 'testnet', policyTemplate: 'balanced', transaction: { from: account.address, to, value: '0', data: '0x' } }, verdict: verdict('caution') }
  }
  it('is single-use, action-bound and rejects fabricated tokens', () => {
    const r = review()
    const token = offerApproval('match', r)
    const approval = takeApproval(token, 'match')
    expect(matchesApproval(approval, r)).toBe(true)
    expect(takeApproval(token, 'match')).toBeUndefined()
    expect(takeApproval('fabricated', 'match')).toBeUndefined()
    expect(takeApproval(offerApproval('match', r), 'lapse')).toBeUndefined()
  })
  it('requires new consent when the transaction or findings change', () => {
    const r = review()
    const approval = takeApproval(offerApproval('match', r), 'match')
    const changed = structuredClone(r)
    changed.request.transaction = { from: account.address, to, value: '1', data: '0x' }
    expect(matchesApproval(approval, changed)).toBe(false)
    r.verdict.findings[0]!.values.address = account.address
    expect(matchesApproval(approval, r)).toBe(false)
  })
  it('rejects expired approvals', () => {
    const r = review()
    r.verdict.expiresAt = new Date(0).toISOString()
    expect(takeApproval(offerApproval('match', r), 'match')).toBeUndefined()
  })
})
