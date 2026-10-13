import { NextResponse } from 'next/server'
import { getState } from '@/lib/venue'

export const dynamic = 'force-dynamic'

/** `GET /api/state` - the projection for all three viewers, plus the tape. */
export async function GET() {
  try {
    const state = await getState()
    // bigint is not JSON - the console renders these as strings throughout.
    return new NextResponse(
      JSON.stringify(state, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
