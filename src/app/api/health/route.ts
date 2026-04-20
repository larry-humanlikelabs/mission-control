import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getLatestHealthAudit, runHealthCouncil } from '@/lib/health-council'

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
      logger.info('Health Council: manual run triggered')
      const result = await runHealthCouncil()
      return NextResponse.json({ triggered: true, audit: result })
    }

    const latest = getLatestHealthAudit()

    if (!latest) {
      return NextResponse.json({ error: 'No audit run found. Trigger a manual run first.' }, { status: 404 })
    }

    return NextResponse.json({ audit: latest })
  } catch (err: any) {
    logger.error({ err }, 'Health API: unexpected error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
