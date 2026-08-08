/**
 * Give viewer A the holder slot that viewer B cannot legally use.
 *
 *   pnpm tsx scripts/rebalance-holders.ts
 *
 * Once credentials are mirrored from the real registry, viewer B sits at sub-tier 9 against
 * an asset requiring 70, so any security it holds is unmovable: the rule refuses it as the
 * sending side. Meanwhile viewer A is properly credentialed but holds nothing, and with the
 * cap full every ask is correctly hidden from it, because taking one would make it a holder
 * the cap has no room for.
 *
 * This retires viewer B's position and issues to viewer A, leaving the holder count
 * unchanged. Viewer B's credential is lifted only for the burn and immediately restored to
 * the real sub-tier 9, because that failing credential is the whole point of pane B.
 */
import { account, artifact, loadEnv, publicClient, walletClient } from './lib/chain'

loadEnv()

async function main() {
  const pub = publicClient()
  const owner = walletClient('W_PKEY')
  const policy = process.env.MOCK_POLICY_ADDRESS as `0x${string}`
  const security = process.env.LISTED_ADDRESS as `0x${string}`
  const { abi: policyAbi } = artifact('MockPolicy')
  const { abi: listedAbi } = artifact('Listed')

  const b = account('W_PKEY').address
  const a = account('VIEWER_A_PKEY').address

  const send = async (req: unknown) => {
    const hash = await owner.writeContract(req as never)
    await pub.waitForTransactionReceipt({ hash })
    return hash
  }
  const balance = (who: string) =>
    pub.readContract({
      address: security,
      abi: listedAbi,
      functionName: 'balanceOf',
      args: [who],
    }) as Promise<bigint>
  const holders = () =>
    pub.readContract({ address: security, abi: listedAbi, functionName: 'holderCount', args: [] })

  console.log(`  before: holders=${await holders()} viewerB=${await balance(b)} viewerA=${await balance(a)}`)

  const stuck = await balance(b)
  if (stuck > 0n) {
    await send({
      address: policy,
      abi: policyAbi,
      functionName: 'setCredential',
      args: [b, '0x0000', '0x4344', 50, 75, 0n],
    })
    await send({ address: security, abi: listedAbi, functionName: 'burn', args: [b, stuck] })
    await send({
      address: policy,
      abi: policyAbi,
      functionName: 'setCredential',
      args: [b, '0x0000', '0x4344', 20, 9, 0n],
    })
    console.log('  viewer B position retired, credential restored to the real sub-tier 9')
  }

  if ((await balance(a)) === 0n) {
    await send({ address: security, abi: listedAbi, functionName: 'mint', args: [a, 5_000n] })
  }
  console.log(`  after:  holders=${await holders()} viewerB=${await balance(b)} viewerA=${await balance(a)}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
