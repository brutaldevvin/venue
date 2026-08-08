import { aesEncrypt } from './crypto'
import { VerifyCode } from './types'
import type { CleanverseConfig } from './config'
import type { ApassRecord, CvResponse, VerifyResult } from './types'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Stable business errors must NOT be retried - the answer will not change. */
function isStableError(message: string): boolean {
  return /not found|CN_\d+|already exists|invalid|incorrect|format|must be|cannot be null|parameter|too frequent|NoAPass/i.test(
    message,
  )
}

/** A non-success response that looks like a transient sandbox hiccup. */
function isTransient(body: { code?: string; message?: string }): boolean {
  return body?.code !== '0000' && !isStableError(body?.message ?? '')
}

/**
 * Typed client over the Cleanverse v3 API.
 *
 * Encryption is per-endpoint, not global - confirmed against the live sandbox on Aug 7:
 *
 *   skills/*                      no auth, no encryption
 *   cooperate/query_apass         `api-id` header, plain body
 *   cooperate/verify_apass        `api-id` header, plain body
 *   cooperate/atoken/*            `api-id` header, AES-encrypted body
 *
 * Sending a plain body to `atoken/*` returns HTTP 403 `Forbidden.Data decryption failed.`,
 * which reads like an auth failure and is not one. No `X-Request-ID` is required anywhere.
 */
export class CleanverseClient {
  constructor(private readonly cfg: CleanverseConfig) {}

  private async post<T = unknown>(
    url: string,
    headers: Record<string, string>,
    payload: unknown,
    retry: boolean,
  ): Promise<CvResponse<T>> {
    const attempts = retry ? 3 : 1
    let last: CvResponse<T> | undefined
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await delay(200 * i)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(payload),
        })
        const text = await res.text()
        // The 403 from an unencrypted atoken body is plain text, not JSON.
        try {
          last = JSON.parse(text) as CvResponse<T>
        } catch {
          return { code: String(res.status), message: text, data: null as T }
        }
        if (res.ok && !isTransient(last)) return last
      } catch (err) {
        if (i === attempts - 1) throw err
      }
    }
    if (last) return last
    throw new Error('cleanverse request failed after retries')
  }

  private cooperate<T = unknown>(
    path: string,
    body: unknown,
    opts: { encrypted?: boolean; retry?: boolean } = {},
  ): Promise<CvResponse<T>> {
    const payload = opts.encrypted ? { data: aesEncrypt(JSON.stringify(body), this.cfg.appKey) } : body
    return this.post<T>(
      `${this.cfg.cooperateBase}/${path}`,
      { 'api-id': this.cfg.apiId },
      payload,
      opts.retry ?? false,
    )
  }

  private skills<T = unknown>(path: string, body: unknown, retry = false): Promise<CvResponse<T>> {
    return this.post<T>(`${this.cfg.skillsBase}/${path}`, {}, body, retry)
  }

  // ---- CVI: the credential lookup Venue projects the book against ------------

  /**
   * The A-Pass record for a wallet, or null if it has none.
   *
   * Prefer the cooperate surface: it returns a populated `cvRecordId` where the skills
   * surface returns null for the same wallet. `skills/query_apass` needs no credentials at
   * all, so it stays available as a fallback if the app key is ever rejected.
   */
  async queryApass(p: { chain: string; address: string }, surface: 'cooperate' | 'skills' = 'cooperate') {
    const res =
      surface === 'cooperate'
        ? await this.cooperate<ApassRecord>('query_apass', p, { retry: true })
        : await this.skills<ApassRecord>('query_apass', p, true)
    // A missing credential comes back as CN_001 - unverified, not an error.
    return res.code === '0000' ? res.data : null
  }

  /**
   * Whether a wallet may hold a given CVA, and - the reason this exists - the registry link
   * to send an unverified viewer to.
   *
   * `canTransfer` reverts identically for "no credential" and "tier too low", so the chain
   * cannot tell you which. Only this call can, and the "why" is what turns Venue's empty
   * pane into onboarding rather than a dead end.
   */
  async verifyApass(p: { chain: string; atoken: string; address: string }): Promise<VerifyResult> {
    const res = await this.cooperate<{
      code: number
      message: string
      magickLink?: string
      chain?: string
      atoken?: string
      address?: string
    }>('verify_apass', p, { retry: true })
    const d = res.data
    return {
      code: (d?.code ?? VerifyCode.NoApass) as VerifyCode,
      message: d?.message ?? res.message,
      magickLink: d?.magickLink,
      chain: d?.chain ?? p.chain,
      atoken: d?.atoken ?? p.atoken,
      address: d?.address ?? p.address,
    }
  }

  /**
   * Freeze (2) or reactivate (1) an A-Pass. Body is AES-encrypted, and it is a write, so it
   * is never retried: re-applying a state change is worse than reporting a timeout.
   *
   * This is what a real credential lapse looks like. Revoking a credential in a contract we
   * control would prove nothing; freezing it at the registry is the event a venue would
   * actually receive, and the watcher reacts to it identically.
   */
  updateStatus(input: {
    wallet: { chain: string; address: string }
    status: 1 | 2
    customerId?: string
    cvRecordId?: string
    blacklistReason?: string
  }): Promise<CvResponse> {
    return this.cooperate(
      'update_status',
      {
        wallet: input.wallet,
        status: String(input.status),
        customerId: input.customerId,
        cvRecordId: input.cvRecordId,
        blacklistReason: input.blacklistReason,
      },
      { encrypted: true },
    )
  }

  // ---- CVA: issuance and registration ---------------------------------------

  /** Method A - issue a new CVA. Body must be AES-encrypted. Write, so no retry. */
  launchAtoken(input: Record<string, unknown>): Promise<CvResponse> {
    return this.cooperate('atoken/launch', input, { encrypted: true })
  }

  /** Method B - register an already-deployed token. Needs an owner signature over the chain payload. */
  registerAtoken(input: Record<string, unknown>): Promise<CvResponse> {
    return this.cooperate('atoken/register_atoken', input, { encrypted: true })
  }

  /** Official Travel Rule report for a settled leg. One per leg, per the submission. */
  downloadTravelRule(p: {
    txHash: string
    wallet: { chain: string; address: string }
    customerId?: string
    cvRecordId?: string
  }): Promise<CvResponse> {
    return this.cooperate('download_travel_rule', p, { retry: true })
  }
}
