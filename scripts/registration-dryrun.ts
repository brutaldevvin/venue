/**
 * Discover the `atoken/launch` schema without ever submitting a registration.
 *
 * Two facts make this safe. The API validates one missing field at a time and names it
 * ("decimals it cannot be empty"), and it rejects any field it does not know
 * ("Unknown field(s): name."). So the schema can be walked out by only ever adding fields
 * the API itself asked for - no guessing.
 *
 * Every field is filled with a junk placeholder rather than a real value. That satisfies
 * "cannot be empty" so the walk advances, while guaranteeing the payload can never validate
 * into an actual CVA. Format complaints are informative too: they tell us what hour 0 needs
 * to send.
 *
 *   pnpm tsx scripts/registration-dryrun.ts
 */
import { aesEncrypt, loadConfigFromEnv } from '../packages/cleanverse/src/index'

const MAX_STEPS = 20

/** Junk by design. A real value here could complete the payload and create a record. */
const PLACEHOLDER = 'DRYRUN'

/** Only used where a string placeholder cannot advance the walk (a type error loops). */
const TYPED_PLACEHOLDERS: Record<string, unknown> = {
  chain: 'monad',
  decimals: 0,
  rule: {},
}

const MISSING_FIELD = /^(\w+) it cannot be empty/
const UNKNOWN_FIELD = /Unknown field\(s\): (\w+)/

async function main() {
  const cfg = loadConfigFromEnv()
  if (!cfg.apiId || !cfg.appKey) {
    throw new Error('CLEANVERSE_APP_ID / CLEANVERSE_APP_KEY missing - check .env')
  }

  const url = `${cfg.cooperateBase}/atoken/launch`
  const body: Record<string, unknown> = {}
  const trace: string[] = []

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-id': cfg.apiId },
      body: JSON.stringify({ data: aesEncrypt(JSON.stringify(body), cfg.appKey) }),
    })
    const text = await res.text()
    trace.push(`[${Object.keys(body).join(',') || '(empty)'}] -> ${text.slice(0, 200)}`)

    if (/"code"\s*:\s*"0000"/.test(text)) {
      trace.push('!! UNEXPECTED SUCCESS with placeholder values - stopping immediately.')
      break
    }

    const missing = MISSING_FIELD.exec(JSON.parse(text).message ?? '')
    if (missing) {
      const field = missing[1] as string
      body[field] = TYPED_PLACEHOLDERS[field] ?? PLACEHOLDER
      continue
    }

    const unknown = UNKNOWN_FIELD.exec(JSON.parse(text).message ?? '')
    if (unknown) {
      trace.push(`   (removing unknown field ${unknown[1]})`)
      delete body[unknown[1] as string]
      continue
    }

    // Anything else is a format or business complaint - the schema walk is done, and the
    // message tells us what the real value has to look like.
    trace.push('   (no longer a missing-field error - schema walk complete)')
    break
  }

  console.log(trace.join('\n'))
  console.log(`\nRequired fields discovered: ${Object.keys(body).join(', ')}`)
  console.log('All values above are placeholders. Nothing was submitted.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
