import { NextResponse } from 'next/server'
import { injectCrossingBids, lapseMaker, resetDemo, runAndSettle } from '@/lib/venue'

export const dynamic = 'force-dynamic'

/** `POST /api/run` - drive the demo beats. `{ action: 'match' | 'lapse' }` */
export async function POST(req: Request) {
  try {
    const { action } = (await req.json()) as { action?: string }
    if (action === 'reset') return NextResponse.json(await resetDemo())
    if (action === 'lapse') return NextResponse.json(await lapseMaker())
    if (action === 'cross') await injectCrossingBids()
    return NextResponse.json(await runAndSettle())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
