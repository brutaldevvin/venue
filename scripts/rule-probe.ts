/**
 * Probe the shape of `atoken/launch`'s `rule` field. `icon` is held junk throughout, so no
 * combination here can validate into a real CVA.
 */
import { aesEncrypt, loadConfigFromEnv } from '../packages/cleanverse/src/index'

const cfg = loadConfigFromEnv()
const url = `${cfg.cooperateBase}/atoken/launch`

const base = {
  icon: 'DRYRUN',
  token_symbol: 'VNU',
  decimals: 18,
  admin_address: '0x03681955065AF6EA51660dd63e7634fd0dE4d0a8',
  chain: 'monad',
  token_name: 'Venue Reg S Note',
}

const camel = {
  allowedGroup: '',
  allowedSubGroup: 'CD',
  minTier: 0,
  minSubTier: 9,
  poolCountryBitmap: 0,
}
const snake = {
  allowed_group: '',
  allowed_sub_group: 'CD',
  min_tier: 0,
  min_sub_tier: 9,
  pool_country_bitmap: 0,
}

const shapes: Array<[string, unknown]> = [
  ['empty object', {}],
  ['camelCase RuleV2', camel],
  ['snake_case RuleV2', snake],
  ['array of camelCase', [camel]],
  ['array of snake_case', [snake]],
  ['bogus subfield', { nonsense_field: 1 }],
]

async function main() {
  for (const [label, rule] of shapes) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-id': cfg.apiId },
      body: JSON.stringify({ data: aesEncrypt(JSON.stringify({ ...base, rule }), cfg.appKey) }),
    })
    console.log(`${label.padEnd(20)} -> ${(await res.text()).slice(0, 180)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
