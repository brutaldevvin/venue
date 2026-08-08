/**
 * Register our already-deployed `Listed.sol` as a Cleanverse A-Token (Method B).
 *
 *   pnpm tsx scripts/register-atoken.ts             # print the payload, send nothing
 *   pnpm tsx scripts/register-atoken.ts --submit    # actually register
 *
 * Why this matters: Travel Rule reports are generated for "A-Token and Wrapped A-Token
 * transfers only". Our settlements return TR_001 (transaction not found) purely because the
 * token is unregistered: the call path itself is proven working against a registered token,
 * returning code 0000 and a downloadable PDF. Registering closes the last gap.
 *
 * Registration does not change how `Listed.sol` gates transfers: the policy is an immutable
 * constructor argument and still points wherever it was deployed against. Registration makes
 * Cleanverse *index* the token, which is what report generation needs.
 *
 * Per the v3 docs, `owner_signature` is an EIP-191 personal_sign by the token owner over
 * lowercase(chain) concatenated with the A-Token address, and the body is AES-encrypted.
 * Issuance is immediate in UAT - every entry in `list_my_atokens` has issuedAt == createTime
 * - so there is no review clock to wait on.
 */
import { aesEncrypt, loadConfigFromEnv } from '../packages/cleanverse/src/index'
import { account, loadEnv } from './lib/chain'

loadEnv()

const CHAIN = 'monad'

async function main() {
  const cfg = loadConfigFromEnv()
  const submit = process.argv.includes('--submit')

  const token = (process.env.LISTED_ADDRESS ?? '').toLowerCase()
  if (!token) throw new Error('LISTED_ADDRESS missing - deploy first')

  // The owner is whoever deployed Listed.sol, which is W_PKEY (see scripts/deploy.ts).
  const owner = account('W_PKEY')
  const message = `${CHAIN.toLowerCase()}${token}`
  const signature = await owner.signMessage({ message })

  const payload = {
    chain: CHAIN,
    atoken_address: token,
    owner_signature: signature,
    // Required, and must be a reachable URL. There is no public host for the brand assets
    // yet, so this is the one field that still needs a real value.
    atoken_icon: process.env.VENUE_ICON_URL ?? '',
  }

  console.log('signing owner:', owner.address)
  console.log('signed message:', message)
  console.log(JSON.stringify({ ...payload, owner_signature: `${signature.slice(0, 18)}...` }, null, 2))

  if (!payload.atoken_icon) {
    console.error('\nVENUE_ICON_URL is unset - `atoken_icon` is required and must be a real URL.')
    process.exit(1)
  }
  if (!submit) {
    console.log('\nDry run. Pass --submit to register (creates a real record).')
    return
  }

  const res = await fetch(`${cfg.cooperateBase}/atoken/register_atoken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-id': cfg.apiId },
    body: JSON.stringify({ data: aesEncrypt(JSON.stringify(payload), cfg.appKey) }),
  })
  console.log(`\n${res.status} ${await res.text()}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
