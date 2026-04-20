import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface Note {
  id: number
  content: string
  captured_at: number
  source: string
  project_id: number | null
  tags: string[]
  promoted_to: { type: string; target_id: number } | null
  status: string
  created_at: number
}

function parseNoteRow(row: any): Note {
  return {
    ...row,
    tags: row.tags ? JSON.parse(row.tags) : [],
    promoted_to: row.promoted_to ? JSON.parse(row.promoted_to) : null,
  }
}

/**
 * GET /api/notes — List notes with optional status filter
 * Query params: status (raw|triaged|promoted|archived), project_id, limit, offset
 */
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const status = searchParams.get('status')
    const projectId = searchParams.get('project_id')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')

    let query = `SELECT * FROM notes WHERE workspace_id = ?`
    const params: any[] = [workspaceId]

    if (status) {
      query += ` AND status = ?`
      params.push(status)
    }
    if (projectId) {
      query += ` AND project_id = ?`
      params.push(projectId)
    }

    query += ` ORDER BY captured_at DESC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const rows = db.prepare(query).all(...params) as any[]
    const notes = rows.map(parseNoteRow)

    const countQuery = `SELECT COUNT(*) as count FROM notes WHERE workspace_id = ?` +
      (status ? ` AND status = '${status}'` : '') +
      (projectId ? ` AND project_id = '${projectId}'` : '')
    const { count } = db.prepare(countQuery).get(workspaceId) as { count: number }

    return NextResponse.json({ notes, total: count })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/notes error')
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 })
  }
}

/**
 * POST /api/notes — Create a new note
 * Body: { content, source, project_id?, tags? }
 * Auto-triage: infers 1-3 tags and suggests promotion
 */
export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    const { content, source = 'api', project_id, tags: providedTags } = body

    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    // Auto-triage: infer tags using keyword heuristics (lightweight, no LLM dependency)
    const inferredTags = inferTags(content)
    const tags = [...new Set([...(providedTags || []), ...inferredTags])].slice(0, 5)

    // Suggest promotion based on content patterns
    const suggestion = suggestPromotion(content)

    const stmt = db.prepare(`
      INSERT INTO notes (content, captured_at, source, project_id, tags, status, workspace_id)
      VALUES (?, ?, ?, ?, ?, 'raw', ?)
    `)

    const result = stmt.run(
      content.trim(),
      Math.floor(Date.now() / 1000),
      source,
      project_id || null,
      JSON.stringify(tags),
      workspaceId
    )

    const note = parseNoteRow({
      id: result.lastInsertRowid,
      content: content.trim(),
      captured_at: Math.floor(Date.now() / 1000),
      source,
      project_id: project_id || null,
      tags,
      promoted_to: null,
      status: 'raw',
      created_at: Math.floor(Date.now() / 1000),
    })

    return NextResponse.json({ note, suggestion }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/notes error')
    return NextResponse.json({ error: 'Failed to create note' }, { status: 500 })
  }
}

/**
 * DELETE /api/notes — Delete a note
 * Body: { id }
 */
export async function DELETE(request: NextRequest) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const result = db.prepare(
      `DELETE FROM notes WHERE id = ? AND workspace_id = ?`
    ).run(body.id, workspaceId)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/notes error')
    return NextResponse.json({ error: 'Failed to delete note' }, { status: 500 })
  }
}

/** PATCH /api/notes — Update note status, tags, or promoted_to */
export async function PATCH(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const allowed = ['status', 'tags', 'promoted_to', 'project_id']
    const updates: string[] = []
    const values: any[] = []

    for (const key of allowed) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`)
        values.push(
          key === 'tags' ? JSON.stringify(body[key]) :
          key === 'promoted_to' ? JSON.stringify(body[key]) :
          body[key]
        )
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    values.push(body.id, workspaceId)
    const result = db.prepare(
      `UPDATE notes SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`
    ).run(...values)

    if (result.changes === 0) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 })
    }

    const updated = db.prepare(`SELECT * FROM notes WHERE id = ?`).get(body.id) as any
    return NextResponse.json({ note: parseNoteRow(updated) })
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/notes error')
    return NextResponse.json({ error: 'Failed to update note' }, { status: 500 })
  }
}

// ─── Auto-triage helpers ─────────────────────────────────────────────────────

const TASK_KEYWORDS = ['build', 'create', 'fix', 'update', 'add', 'remove', 'implement', 'design', 'write', 'ship', 'deploy', 'test', 'review', 'check', 'research', 'analyze']
const MEMORY_KEYWORDS = ['remember', 'learned', 'insight', 'pattern', 'preference', 'context', 'history', 'important', 'note to self', 'worth remembering']
const PROJECT_KEYWORDS = ['project', 'initiative', 'launch', 'milestone', 'deadline', 'roadmap', 'quarterly']

function inferTags(content: string): string[] {
  const lower = content.toLowerCase()
  const tags: string[] = []

  if (TASK_KEYWORDS.some(k => lower.includes(k))) tags.push('action')
  if (MEMORY_KEYWORDS.some(k => lower.includes(k))) tags.push('memory')
  if (PROJECT_KEYWORDS.some(k => lower.includes(k))) tags.push('project')
  if (lower.includes('urgent') || lower.includes('asap') || lower.includes('critical')) tags.push('urgent')
  if (lower.includes('question') || lower.includes('?') || lower.includes('clarify')) tags.push('question')
  if (lower.includes('idea') || lower.includes('thought') || lower.includes('concept')) tags.push('idea')
  if (lower.includes('link') || lower.includes('http') || lower.includes('url') || lower.includes('www')) tags.push('link')
  if (lower.length > 200) tags.push('long-form')

  return tags.slice(0, 3)
}

function suggestPromotion(content: string): { type: 'keep' | 'task' | 'memory' | 'project'; confidence: number; reason: string } {
  const lower = content.toLowerCase()
  const wordCount = content.split(/\s+/).length

  // High-confidence task: starts with verb + specific deliverable
  if (TASK_KEYWORDS.some(k => lower.startsWith(k) || lower.includes(`need to ${k}`) || lower.includes(`should ${k}`))) {
    return { type: 'task', confidence: 0.85, reason: 'Looks like a to-do item — convert to a task?' }
  }

  // High-confidence memory: personal insight or learning
  if (MEMORY_KEYWORDS.some(k => lower.includes(k)) || lower.includes('i learned') || lower.includes('key takeaway')) {
    return { type: 'memory', confidence: 0.82, reason: 'Seems like something worth remembering — save to memory?' }
  }

  // Medium confidence: short, action-oriented text
  if (wordCount < 20 && (TASK_KEYWORDS.some(k => lower.includes(k)) || lower.includes('!'))) {
    return { type: 'task', confidence: 0.70, reason: 'This might be a quick action — make it a task?' }
  }

  // Default: keep as note
  return { type: 'keep', confidence: 0.60, reason: 'Saved as a note for later.' }
}
