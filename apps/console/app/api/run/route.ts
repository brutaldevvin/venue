import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'
import { injectCrossingBids, lapseMaker, resetDemo, runAndSettle } from '@/lib/venue'

export const dynamic = 'force-dynamic'

/** `POST /api/run` - drive the demo beats. `{ action: 'match' | 'lapse' }` */
export async function POST(req: Request) {
  const limit = rateLimit(req)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'too many requests', retryAfterSeconds: limit.retryAfter },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    )
  }
  try {
    const { action } = (await req.json()) as { action?: string }
    if (action === 'reset') return NextResponse.json(await resetDemo())
    if (action === 'lapse') return NextResponse.json(await lapseMaker())
    if (action === 'cross') await injectCrossingBids()
    return NextResponse.json(await runAndSettle())
  } catch (e) {
    console.error('[api/run] failed', e)
    return NextResponse.json({ error: 'demo action failed; no value moved' }, { status: 500 })
  }
}
