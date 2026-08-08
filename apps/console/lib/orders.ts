import type { Address, Order } from '@venue/core'
import { keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { monadTestnet } from './chain'

/**
 * Orders are off-chain, signed by the maker, held by the venue, and settled on-chain.
 *
 * The signature is what completes the trust boundary the submission claims: an operator can
 * hide an order, but cannot fabricate one. Verification is therefore not decorative - the
 * book rejects anything it cannot attribute.
 */
export const ORDER_TYPES = {
  Order: [
    { name: 'asset', type: 'address' },
    { name: 'maker', type: 'address' },
    { name: 'side', type: 'string' },
    { name: 'price', type: 'uint256' },
    { name: 'qty', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const

export function domain(verifyingContract: Address) {
  return {
    name: 'Venue',
    version: '1',
    chainId: monadTestnet.id,
    verifyingContract,
  } as const
}

export function orderId(o: Omit<Order, 'id' | 'signature'>): string {
  return keccak256(
    toHex(`${o.asset}:${o.maker}:${o.side}:${o.price}:${o.qty}:${o.expiry}:${o.nonce}`),
  ).slice(0, 18)
}

export async function signOrder(
  privateKey: `0x${string}`,
  o: Omit<Order, 'id' | 'signature'>,
  settlement: Address,
): Promise<Order> {
  const acct = privateKeyToAccount(privateKey)
  const signature = await acct.signTypedData({
    domain: domain(settlement),
    types: ORDER_TYPES,
    primaryType: 'Order',
    message: {
      asset: o.asset,
      maker: o.maker,
      side: o.side,
      price: o.price,
      qty: o.qty,
      expiry: BigInt(o.expiry),
      nonce: o.nonce,
    },
  })
  return { ...o, id: orderId(o), signature }
}

export async function verifyOrder(o: Order, settlement: Address): Promise<boolean> {
  const { verifyTypedData } = await import('viem')
  try {
    return await verifyTypedData({
      address: o.maker,
      domain: domain(settlement),
      types: ORDER_TYPES,
      primaryType: 'Order',
      message: {
        asset: o.asset,
        maker: o.maker,
        side: o.side,
        price: o.price,
        qty: o.qty,
        expiry: BigInt(o.expiry),
        nonce: o.nonce,
      },
      signature: o.signature,
    })
  } catch {
    return false
  }
}
