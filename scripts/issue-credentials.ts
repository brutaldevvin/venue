/**
 * Issue the demo's credentials on the real Cleanverse CVI registry.
 *
 *   pnpm tsx scripts/issue-credentials.ts             # show what would be issued
 *   pnpm tsx scripts/issue-credentials.ts --submit    # issue them
 *
 * The three panes need three genuinely different CVI states on one asset. The two
 * pre-existing sandbox wallets cannot provide that: both sit at sub-tier 9, and we do not
 * control the registry to change them. `generate_apass` does let us mint credentials at a
 * chosen sub-tier, so the contrast comes from real A-Passes rather than invented ones.
 *
 *   viewer A   a wallet we credential at sub-tier 75   passes a minSubTier 70 rule
 *   viewer B   W_PKEY, already sub-tier 9              fails it
 *   viewer C   FACILITATOR, no A-Pass at all           unverified
 *
 * The market makers are credentialed too, so the resting book is quoted by parties who hold
 * real A-Passes rather than anonymous keys.
 *
 * `subTier` is the only lever we set. `tier` is derived by Cleanverse (our sub-tier 75
 * wallets come back as tier 50), and `identityDataList` is optional, so no personal data is
 * sent for these test identities.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aesEncrypt, loadConfigFromEnv } from '../packages/cleanverse/src/index'
import { account, loadEnv, ROOT } from './lib/chain'

loadEnv()

const ELIGIBLE_SUB_TIER = 75
const EXPIRES = 1893456000 // 2030-01-01

interface Target {
  label: string
  address: string
  subTier: number | null
}

function targets(): Target[] {
  const out: Target[] = [
    { label: 'viewer A (eligible)', address: account('VIEWER_A_PKEY').address, subTier: ELIGIBLE_SUB_TIER },
    { label: 'viewer B (sub-tier 9)', address: account('W_PKEY').address, subTier: null },
    { label: 'viewer C (unverified)', address: account('FACILITATOR_PKEY').address, subTier: null },
  ]
  try {
    const makers: { address: string }[] = JSON.parse(
      readFileSync(join(ROOT, '.venue-makers.json'), 'utf8'),
    )
    makers.forEach((m, i) =>
      out.push({ label: `market maker ${i}`, address: m.address, subTier: ELIGIBLE_SUB_TIER }),
    )
  } catch {
    console.error('  no .venue-makers.json; run seed first')
  }
  return out
}

/** Customer ids must be unique, 12+ chars, alphanumeric only. */
function customerId(address: string): string {
  return `venue${address.slice(2, 18)}`.replace(/[^A-Za-z0-9]/g, '')
}

async function issue(cfg: ReturnType<typeof loadConfigFromEnv>, t: Target) {
  const body = {
    customerId: customerId(t.address),
    subTier: t.subTier,
    subGroup: 'CD',
    expirationTime: EXPIRES,
    wallet: { address: t.address, chain: 'monad' },
    override: true,
  }
  const res = await fetch(`${cfg.cooperateBase}/generate_apass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-id': cfg.apiId },
    body: JSON.stringify({ data: aesEncrypt(JSON.stringify(body), cfg.appKey) }),
  })
  const j = (await res.json()) as { code: string; message: string; data?: { cvRecordId?: string; tier?: string } }
  return j.code === '0000'
    ? `issued, cvRecordId ${j.data?.cvRecordId}, tier ${j.data?.tier}`
    : `${j.code} ${j.message.slice(0, 80)}`
}

async function query(cfg: ReturnType<typeof loadConfigFromEnv>, address: string) {
  const res = await fetch(`${cfg.cooperateBase}/query_apass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-id': cfg.apiId },
    body: JSON.stringify({ chain: 'monad', address }),
  })
  const j = (await res.json()) as { code: string; data?: { tier?: string; subTier?: number } }
  return j.code === '0000' ? `tier ${j.data?.tier}, subTier ${j.data?.subTier}` : 'none'
}

async function main() {
  const cfg = loadConfigFromEnv()
  const submit = process.argv.includes('--submit')
  const list = targets()

  for (const t of list) {
    const action = t.subTier === null ? 'leave as is' : `issue sub-tier ${t.subTier}`
    console.log(`  ${t.label.padEnd(22)} ${t.address}  ${action}`)
  }
  if (!submit) {
    console.log('\nDry run. Pass --submit to issue.')
    return
  }

  console.log('')
  for (const t of list) {
    if (t.subTier === null) continue
    console.log(`  ${t.label.padEnd(22)} ${await issue(cfg, t)}`)
  }

  console.log('\nverifying against the registry:')
  for (const t of list) {
    console.log(`  ${t.label.padEnd(22)} ${await query(cfg, t.address)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
