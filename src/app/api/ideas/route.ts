import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const db = getDatabase()
  const ideas = db.prepare('SELECT * FROM idea_archive ORDER BY created_at DESC').all()
  return NextResponse.json({ ideas })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const db = getDatabase()
  const body = await request.json()
  const { action, id } = body

  if (action === 'generate') {
    // In production, this spawns ideation sub-agent
    const ideas = [
      { topic: 'AI Agents in 2026', hook: 'Why every business will need an agent team', angle: 'Future of work', confidence_tier: 'a' },
      { topic: 'AI Agents in 2026', hook: 'The $10M agent economy', angle: 'Market opportunity', confidence_tier: 'a' }
    ]
    for (const idea of ideas) {
      db.prepare(`
        INSERT INTO idea_archive (topic, hook, angle, format, source, confidence_tier, status, created_at)
        VALUES (?, ?, ?, ?, 'felix', ?, 'pending', ?)
      `).run(idea.topic, idea.hook, idea.angle, idea.format || 'long-form', idea.confidence_tier, Math.floor(Date.now() / 1000))
    }
    return NextResponse.json({ generated: ideas.length, ideas })
  }

  if (action === 'approve') {
    db.prepare('UPDATE idea_archive SET status = ? WHERE id = ?').run('approved', id)
    return NextResponse.json({ success: true })
  }

  if (action === 'reject') {
    db.prepare('UPDATE idea_archive SET status = ? WHERE id = ?').run('rejected', id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
