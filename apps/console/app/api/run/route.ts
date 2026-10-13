import { NextResponse } from 'next/server'
import { guardError, type ConfirmCaution } from '@venue/guard'
import { beginRun, endRun, matchesApproval, offerApproval, takeApproval } from '@/lib/guard'
import { injectCrossingBids, lapseMaker, runAndSettle } from '@/lib/venue'

export const dynamic = 'force-dynamic'

/** POST /api/run: one demo action, optionally resuming a specific caution review. */
export async function POST(req: Request) {
  if (!beginRun()) return NextResponse.json({ error: 'Another transaction action is running' }, { status: 409 })
  let action = ''
  try {
    const body = await req.json()
    action = body.action
    if (!['match', 'lapse', 'cross'].includes(action)) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
    let approval = takeApproval(body.confirmation, action)
    if (body.confirmation && !approval) {
      return NextResponse.json({ error: 'Baret confirmation expired or invalid; run the action again' }, { status: 409 })
    }
    const resumed = !!approval
    const confirm: ConfirmCaution = async (review) => {
      const accepted = matchesApproval(approval, review)
      if (accepted) approval = undefined
      return accepted
    }
    if (action === 'lapse') return NextResponse.json(await lapseMaker(confirm))
    if (action === 'cross' && !resumed) await injectCrossingBids()
    return NextResponse.json(await runAndSettle(confirm))
  } catch (e) {
    const refusal = guardError(e)
    if (refusal?.review?.verdict.decision === 'caution' && refusal.message.startsWith('Baret caution:')) {
      return NextResponse.json({
        error: refusal.message,
        guard: {
          decision: 'caution',
          findings: refusal.review.verdict.findings,
          transaction: refusal.review.request.transaction,
          confirmation: offerApproval(action, refusal.review),
        },
      }, { status: 409 })
    }
    return NextResponse.json({ error: refusal?.message ?? (e as Error).message }, { status: refusal ? 422 : 500 })
  } finally {
    endRun()
  }
}
