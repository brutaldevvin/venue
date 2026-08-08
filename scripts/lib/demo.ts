import { account } from './chain'

/**
 * The three viewers the demo turns on. All three are real Monad addresses; only the first
 * two need gas, because orders are signed off-chain and only settlement is a transaction.
 *
 * `A` and `B` share a wallet-level credential in the live CVI registry - both are tier 20,
 * sub-tier 9 - so the contrast cannot come from the wallets. It comes from the credentials
 * we set on MockPolicy, which is what D3 buys us: one asset, three CVI states, exactly as
 * the submission promises.
 */
export interface Viewer {
  key: 'A' | 'B' | 'C'
  label: string
  address: `0x${string}`
  /** null means no credential at all - the unverified pane. */
  credential: { group: `0x${string}`; subGroup: `0x${string}`; tier: number; subTier: number } | null
  note: string
}

export function viewers(): Viewer[] {
  return [
    {
      key: 'A',
      label: 'tier 34 · US',
      address: account('W_PKEY').address,
      credential: { group: '0x0000', subGroup: '0x4344', tier: 34, subTier: 75 },
      note: 'satisfies the rule set - sees full depth',
    },
    {
      key: 'B',
      label: 'tier 34 · DE',
      address: account('W2_PKEY').address,
      credential: { group: '0x0000', subGroup: '0x4344', tier: 34, subTier: 34 },
      note: 'sub-tier 34 against a required 70 - empty book',
    },
    {
      key: 'C',
      label: 'unverified',
      address: account('FACILITATOR_PKEY').address,
      credential: null,
      note: 'no A-Pass - verification link',
    },
  ]
}

/** An extra counterparty so the book has two sides. Shares viewer A's eligibility. */
export const MARKET_MAKER_PKEY = 'W_PKEY'
