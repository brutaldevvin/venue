import { NextResponse } from 'next/server'
import { placeOrder } from '@/lib/venue'

export const dynamic = 'force-dynamic'

/** `POST /api/orders` - accepts an order from the ticket. `{ viewer, side, price, qty }` */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      viewer?: string
      side?: 'bid' | 'ask'
      price?: string
      qty?: string
    }
    if (!body.viewer || !body.side || !body.price || !body.qty) {
      return NextResponse.json({ ok: false, reason: 'viewer, side, price and qty required' }, { status: 400 })
    }
    const res = await placeOrder({
      viewer: body.viewer,
      side: body.side,
      price: BigInt(body.price),
      qty: BigInt(body.qty),
    })
    return NextResponse.json(res, { status: res.ok ? 200 : 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, reason: (e as Error).message }, { status: 500 })
  }
}
