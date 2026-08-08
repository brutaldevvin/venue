import { createPublicClient, defineChain, http } from 'viem'

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: { default: { name: 'MonadScan', url: 'https://testnet.monadscan.com' } },
})

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'),
})

export const addresses = {
  policy: process.env.MOCK_POLICY_ADDRESS as `0x${string}`,
  security: process.env.LISTED_ADDRESS as `0x${string}`,
  cash: process.env.CASH_ADDRESS as `0x${string}`,
  settlement: process.env.SETTLEMENT_ADDRESS as `0x${string}`,
}

export const policyAbi = [
  {
    type: 'function',
    name: 'canTransfer',
    stateMutability: 'view',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'function',
    name: 'getRulesV2',
    stateMutability: 'view',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'allowedGroup', type: 'bytes2' },
          { name: 'allowedSubGroup', type: 'bytes2' },
          { name: 'minTier', type: 'uint8' },
          { name: 'minSubTier', type: 'uint8' },
          { name: 'poolCountryBitmap', type: 'uint256' },
          { name: 'isBlackList', type: 'bool' },
        ],
      },
    ],
  },
] as const

export const listedAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'a', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'o', type: 'address' },
      { name: 's', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'holderCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'maxHolders',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

export const settlementAbi = [
  {
    type: 'function',
    name: 'settle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'm',
        type: 'tuple',
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'seller', type: 'address' },
          { name: 'buyer', type: 'address' },
          { name: 'qty', type: 'uint256' },
          { name: 'notional', type: 'uint256' },
        ],
      },
    ],
    outputs: [],
  },
] as const

/**
 * The compliance oracle the matcher consults, as an `eth_call` (D6).
 *
 * The deployed CCP policy refuses by reverting with bare `0x` rather than returning false
 * (D4), so a revert and a false are the same answer and both must be caught here. Without
 * this the first real refusal surfaces as an unrelated RPC failure.
 */
export async function canTransfer(
  token: `0x${string}`,
  from: `0x${string}`,
  to: `0x${string}`,
  amount: bigint,
): Promise<boolean> {
  try {
    return (await publicClient.readContract({
      address: addresses.policy,
      abi: policyAbi,
      functionName: 'canTransfer',
      args: [token, from, to, amount],
    })) as boolean
  } catch {
    return false
  }
}
