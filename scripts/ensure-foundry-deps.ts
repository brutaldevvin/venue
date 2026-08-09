import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { ROOT } from './lib/chain'

const contractsDir = join(ROOT, 'contracts')

const deps = [
  {
    name: 'forge-std',
    path: join(contractsDir, 'lib', 'forge-std', 'src', 'Test.sol'),
    spec: 'foundry-rs/forge-std',
  },
  {
    name: 'openzeppelin-contracts',
    path: join(contractsDir, 'lib', 'openzeppelin-contracts', 'contracts', 'token', 'ERC20', 'ERC20.sol'),
    spec: 'OpenZeppelin/openzeppelin-contracts@v5.1.0',
  },
]

function forgeBin(): string {
  if (process.env.FORGE_BIN) return process.env.FORGE_BIN
  const foundryForge = join(homedir(), '.foundry', 'bin', 'forge')
  return existsSync(foundryForge) ? foundryForge : 'forge'
}

function runForge(args: string[]): void {
  const result = spawnSync(forgeBin(), args, { cwd: contractsDir, stdio: 'inherit' })
  if (result.error) {
    console.error(`failed to run forge: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const missing = deps.filter((d) => !existsSync(d.path))
if (missing.length > 0) {
  console.log(`installing Foundry deps: ${missing.map((d) => d.name).join(', ')}`)
  runForge(['install', '--no-git', '--shallow', ...missing.map((d) => d.spec)])
}

const command = process.argv[2]
if (command === undefined) process.exit(0)
if (command !== 'build' && command !== 'test') {
  console.error(`unknown contracts command: ${command}`)
  process.exit(1)
}

runForge([command])
