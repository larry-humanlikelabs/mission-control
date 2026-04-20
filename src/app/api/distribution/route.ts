import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * Distribution Queue API
 * 
 * Schedules content to publish across platforms.
 * Approval gate + Telegram safety window before each post.
 */

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const db = getDatabase()
  const items = db.prepare(`
    SELECT * FROM distribution_items 
    ORDER BY scheduled_for ASC
  `).all()

  return NextResponse.json({ items })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const db = getDatabase()
  const body = await request.json()
  const { action, id } = body

  if (action === 'schedule') {
    const { linked_doc_id, platform, content_body, media_paths, scheduled_for } = body
    const result = db.prepare(`
      INSERT INTO distribution_items (linked_doc_id, platform, content_body, media_paths, scheduled_for, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'queued', ?)
    `).run(
      linked_doc_id || null,
      platform,
      content_body,
      JSON.stringify(media_paths || []),
      scheduled_for,
      Math.floor(Date.now() / 1000)
    )
    return NextResponse.json({ id: result.lastInsertRowid })
  }

  if (action === 'approve') {
    db.prepare(`UPDATE distribution_items SET status = 'approved' WHERE id = ?`).run(id)
    return NextResponse.json({ success: true })
  }

  if (action === 'cancel') {
    db.prepare(`UPDATE distribution_items SET status = 'cancelled' WHERE id = ?`).run(id)
    return NextResponse.json({ success: true })
  }

  if (action === 'reschedule') {
    const { scheduled_for } = body
    db.prepare(`UPDATE distribution_items SET scheduled_for = ?, status = 'queued' WHERE id = ?`).run(scheduled_for, id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
