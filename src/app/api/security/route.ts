import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getLatestSecurityAudit, getPreviousAudit, runSecurityCouncil } from '@/lib/security-council'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const run = searchParams.get('run')

    // Trigger manual run
    if (run === 'true') {
      logger.info('Security Council: manual run triggered')
      const result = await runSecurityCouncil()
      return NextResponse.json({ triggered: true, audit: result })
    }

    // Return latest + diff vs previous
    const latest = getLatestSecurityAudit()
    const previous = getPreviousAudit()

    if (!latest) {
      return NextResponse.json({ error: 'No audit run found. Trigger a manual run first.' }, { status: 404 })
    }

    // Compute diff: findings in latest not in previous
    const previousTitles = new Set(previous?.findings.map(f => f.title) ?? [])
    const newFindings = latest.findings.filter(f => f.new_vs_recurring === 'new')

    return NextResponse.json({
      audit: latest,
      previous_run: previous ? { run_at: previous.run_at, summary: previous.summary } : null,
      diff: {
        new_findings: newFindings,
        new_count: newFindings.length,
        total_findings: latest.findings.length,
      },
    })
  } catch (err: any) {
    logger.error({ err }, 'Security API: unexpected error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
