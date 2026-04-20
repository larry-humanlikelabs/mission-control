import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { runBusinessCouncil } from '@/lib/council'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const db = getDatabase()
  const runs = db.prepare(`
    SELECT * FROM council_runs ORDER BY timestamp DESC LIMIT 10
  `).all()

  // Parse JSON fields
  const parsed = runs.map((r: any) => ({
    ...r,
    findings: JSON.parse(r.findings || '[]'),
    agents_run: JSON.parse(r.agents_run || '[]')
  }))

  return NextResponse.json({ runs: parsed })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  const { action } = body

  if (action === 'run') {
    try {
      const run = await runBusinessCouncil()
      return NextResponse.json({ success: true, run })
    } catch (e) {
      return NextResponse.json({ error: String(e) }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
