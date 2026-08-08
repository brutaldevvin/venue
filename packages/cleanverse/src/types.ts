export type Chain = string

/** Standard Cleanverse response envelope. code "0000" = success. */
export interface CvResponse<T = unknown> {
  code: string
  message: string
  data: T
}

/** A-Pass record from query_apass - the privacy-preserving proof fields for receipts (no PII). */
export interface ApassRecord {
  cvRecordId: string
  subTier: number
  tier: string
  /** 1 = active, 2 = frozen */
  status: number
  expirationTime: number
  subGroup: string
  group: string
  currentKycHash: string
}

/** verify_apass result codes (data.code). 4 is the only "clear to settle" value. */
export enum VerifyCode {
  AtokenNotFound = 1,
  NoApass = 2,
  /** A-Pass exists but cannot transfer: expired / frozen / compliance block. */
  ApassBlocked = 3,
  Valid = 4,
}

export interface VerifyResult {
  code: VerifyCode
  message: string
  /** Registration link returned on a block (offer "get verified here"). */
  magickLink?: string
  chain: string
  atoken: string
  address: string
}

export interface IdentityData {
  idType: 'NID' | 'PASSPORT' | 'DRIVER_LICENSE' | 'HK_MACAO_TAIWAN_PASS' | 'OTHER' | (string & {})
  fullName: string
  issuingCountryISO2: string
  idNumber?: string
  /** yyyy-MM-dd */
  validUntil?: string
}

export interface GenerateApassInput {
  /** unique, min 12 chars */
  customerId: string
  /** 1-99 (our member maps subTier 9 -> tier 20; subTier 99 errors) */
  subTier: number
  /** exactly 2 letters, case-sensitive */
  subGroup: string
  /** unix seconds */
  expirationTime: number
  wallet: { address: string; chain: Chain }
  identityDataList: IdentityData[]
  kycSource?: string
  kycId?: string
  override?: boolean
  bankAccountList?: unknown[]
}

export interface UpdateStatusInput {
  wallet: { chain: Chain; address: string }
  /** 1 = activate/unfreeze, 2 = freeze */
  status: 1 | 2
  customerId?: string
  cvRecordId?: string
  blacklistReason?: string
}
