import { NextResponse } from 'next/server'
import { getState } from '@/lib/venue'

export const dynamic = 'force-dynamic'

function stateError(e: unknown): { error: string; dependency: 'cleanverse_apass' | 'state' } {
  const message = e instanceof Error ? e.message : String(e)
  if (/query_apass|verify_apass|apass|cleanverse/i.test(message)) {
    return {
      error: 'Cleanverse A-Pass API temporarily unavailable; retrying',
      dependency: 'cleanverse_apass',
    }
  }
  return { error: 'state temporarily unavailable; retrying', dependency: 'state' }
}

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
    const body = stateError(e)
    console.error('[api/state] failed')
    return NextResponse.json(body, { status: 503 })
  }
}
