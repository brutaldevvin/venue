import crypto from 'node:crypto'

/**
 * Cleanverse cooperate-API body encryption.
 * Spec: AES/CBC/PKCS5Padding, fixed 16 zero-byte IV, key = base64-decoded api-key,
 * ciphertext base64-encoded and sent as {"data":"<ciphertext>"}.
 * Verified working against the live sandbox (generate_apass / update_status etc.).
 */
const ZERO_IV = Buffer.alloc(16, 0)

function algoFor(key: Buffer): 'aes-256-cbc' | 'aes-128-cbc' {
  if (key.length === 32) return 'aes-256-cbc'
  if (key.length === 16) return 'aes-128-cbc'
  throw new Error(`Unexpected api-key length ${key.length} (expected 16 or 32 bytes after base64-decode)`)
}

export function aesEncrypt(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64')
  const cipher = crypto.createCipheriv(algoFor(key), key, ZERO_IV)
  return cipher.update(plaintext, 'utf8', 'base64') + cipher.final('base64')
}

export function aesDecrypt(ciphertextB64: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64')
  const decipher = crypto.createDecipheriv(algoFor(key), key, ZERO_IV)
  return decipher.update(ciphertextB64, 'base64', 'utf8') + decipher.final('utf8')
}
