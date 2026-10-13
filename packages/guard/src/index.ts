import { GuardUnreachableError, TransactionGuard, type AnalyzeRequest, type AnalyzeResponse } from '@baret/guard'
import type { LocalAccount } from 'viem'

export type Review = { request: AnalyzeRequest; verdict: AnalyzeResponse }
export type ConfirmCaution = (review: Review) => Promise<boolean>
export class GuardError extends Error {
  constructor(message: string, readonly review?: Review) {
    super(message)
    this.name = 'GuardError'
  }
}

const guard = new TransactionGuard({ baseUrl: 'https://baret-monad-api.onrender.com' })

/** Viem wraps signer errors; preserve the actual refusal and its findings for the UI. */
export function guardError(error: unknown): GuardError | undefined {
  if (error instanceof GuardError) return error
  if (error instanceof Error && error.cause && error.cause !== error) return guardError(error.cause)
}

/** Wrap the final local signing boundary, including contract calls and deployments. */
export function guardedAccount(
  account: LocalAccount,
  confirm?: ConfirmCaution,
  evaluator: Pick<TransactionGuard, 'evaluate'> = guard,
): LocalAccount {
  return {
    ...account,
    async signTransaction(transaction, options) {
      // Snapshot the unsigned payload before any asynchronous evaluation/confirmation.
      transaction = { ...transaction }
      if (transaction.chainId !== 10143) throw new GuardError('Baret blocked: unsupported chain (expected 10143)')
      const request: AnalyzeRequest = {
        network: 'testnet',
        policyTemplate: 'balanced',
        transaction: {
          from: account.address,
          to: transaction.to ?? null,
          value: (transaction.value ?? 0n).toString(),
          data: transaction.data ?? '0x',
          ...(transaction.gas !== undefined && { gas: transaction.gas.toString() }),
          ...(transaction.gasPrice !== undefined && { gasPrice: transaction.gasPrice.toString() }),
          ...(transaction.maxFeePerGas !== undefined && { maxFeePerGas: transaction.maxFeePerGas.toString() }),
          ...(transaction.maxPriorityFeePerGas !== undefined && { maxPriorityFeePerGas: transaction.maxPriorityFeePerGas.toString() }),
          ...(transaction.nonce !== undefined && { nonce: transaction.nonce }),
        },
      }
      let verdict: AnalyzeResponse
      try {
        verdict = await evaluator.evaluate(request)
      } catch (error) {
        throw new GuardError(error instanceof GuardUnreachableError
          ? `Baret blocked: check unavailable (${error.message})`
          : 'Baret blocked: transaction check failed')
      }
      const review = { request, verdict }
      const reasons = verdict.findings.map((f) => f.code).join(', ') || 'no finding codes supplied'
      const valid = () => verdict.meta.chainId === 10143 && verdict.meta.network === 'testnet'
        && Number.isFinite(Date.parse(verdict.expiresAt)) && Date.parse(verdict.expiresAt) > Date.now()
      if (!valid()) throw new GuardError('Baret blocked: expired verdict or wrong network', review)
      if (verdict.decision === 'blocked' || verdict.findings.some((f) => f.blocking)) throw new GuardError(`Baret blocked: ${reasons}`, review)
      if (verdict.decision === 'caution' && (!confirm || !(await confirm(review)))) {
        throw new GuardError(`Baret caution: ${reasons}. Transaction not signed.`, review)
      }
      if (!valid()) throw new GuardError('Baret blocked: verdict expired during confirmation; retry', review)
      return account.signTransaction(transaction, options)
    },
  }
}
