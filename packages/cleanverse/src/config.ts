import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface CleanverseConfig {
  /** App ID - sent as the `api-id` request header. */
  apiId: string
  /** App Key - base64 AES key, used locally to encrypt cooperate bodies. Never sent. */
  appKey: string
  cooperateBase: string
  skillsBase: string
}

function findEnvFile(start: string): string | null {
  let dir = start
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, '.env')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim()
  }
  return out
}

/**
 * Build config from process.env, falling back to the nearest .env file (walking up
 * from cwd). Defaults to the UAT sandbox base URLs.
 */
export function loadConfigFromEnv(opts: { envPath?: string; cwd?: string } = {}): CleanverseConfig {
  const path = opts.envPath ?? findEnvFile(opts.cwd ?? process.cwd())
  const fileEnv = path && existsSync(path) ? parseEnvFile(path) : {}
  const get = (k: string): string => process.env[k] ?? fileEnv[k] ?? ''
  return {
    apiId: get('CLEANVERSE_APP_ID'),
    appKey: get('CLEANVERSE_APP_KEY'),
    cooperateBase: get('CLEANVERSE_COOPERATE_BASE') || 'https://uatapi.cleanverse.com/api/cooperate',
    skillsBase: get('CLEANVERSE_SKILLS_BASE') || 'https://uatapi.cleanverse.com/api/skills',
  }
}
