import { createInterface } from 'node:readline/promises'
import type { ConfirmCaution } from '@venue/guard'

export const confirmCaution: ConfirmCaution = async ({ request, verdict }) => {
  console.error('Baret caution:', verdict.findings.map((f) => `${f.code}: ${JSON.stringify(f.values)}`).join('\n'))
  console.error(JSON.stringify(request.transaction))
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await prompt.question('Sign this transaction? Type yes to continue: ')).trim() === 'yes'
  } finally {
    prompt.close()
  }
}
