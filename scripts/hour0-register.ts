/**
 * Hour 0: register Venue's CVA. One known-good call, schema confirmed by dry run on Aug 7.
 *
 * Refuses to run without an explicit `--submit`. This creates a real record and starts a
 * review clock, so the default is to print the payload and exit.
 *
 *   pnpm tsx scripts/hour0-register.ts             # print the payload, send nothing
 *   pnpm tsx scripts/hour0-register.ts --submit    # actually register
 *
 * Field names are exactly as discovered - snake_case, and `rule` is a single object rather
 * than an array, so a second cohort needs an on-chain `addRuleV2` afterwards.
 *
 * Field shapes confirmed against the v3 documentation (docs.cleanverse.com), which resolved
 * the one thing the dry run could not: `countries` is an array of ISO 3166-1 **alpha-2**
 * strings, uppercased server-side, with invalid or non-two-letter codes dropped, and empty
 * or omitted meaning no country constraint. The docs also add `is_black_list`, which the
 * dry run never saw because it only ever probed for missing fields, not optional ones.
 */
import { aesEncrypt, loadConfigFromEnv } from '../packages/cleanverse/src/index'

const ADMIN = process.env.VENUE_ADMIN_ADDRESS ?? '0x03681955065AF6EA51660dd63e7634fd0dE4d0a8'

const payload = {
  chain: 'monad',
  token_name: 'Venue Reg S Note',
  token_symbol: 'VNU',
  decimals: 18,
  admin_address: ADMIN,
  // A real URL is required - the dry run used a placeholder here precisely so that no
  // combination of the other fields could complete a submission.
  icon: process.env.VENUE_ICON_URL ?? '',
  rule: {
    allowed_group: '',
    allowed_sub_group: 'CD',
    min_tier: 0,
    // At or below the demo wallets' sub-tier 9, so W_PKEY and W2_PKEY are eligible.
    // The ineligible pane comes from a second listing demanding more, not from a
    // second wallet - both demo wallets carry identical credentials.
    min_sub_tier: 9,
    // Optional. false (or omitted) = the listed countries are the only ones permitted;
    // true = they are the ones refused. Empty list means no country constraint either way,
    // which is what the demo wants: every sandbox wallet returns an empty country list.
    is_black_list: false,
    countries: [] as string[],
  },
}

async function main() {
  const cfg = loadConfigFromEnv()
  const submit = process.argv.includes('--submit')

  console.log(JSON.stringify(payload, null, 2))

  if (!payload.icon) {
    console.error('\nVENUE_ICON_URL is unset - `icon` is required and must be a real URL.')
    process.exit(1)
  }
  if (!submit) {
    console.log('\nDry run. Pass --submit to register (creates a real record).')
    return
  }

  const res = await fetch(`${cfg.cooperateBase}/atoken/launch`, {
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
