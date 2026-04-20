import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import * as fs from 'fs'
import * as path from 'path'

const DOCS_DIR = '/Users/maximus/.openclaw/workspace*/docs/'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, status: auth.status })
  }

  const db = getDatabase()
  
  // Get all docs from database
  const docs = db.prepare(`
    SELECT * FROM documents 
    ORDER BY created_at DESC
    LIMIT 100
  `).all()

  return NextResponse.json({ docs })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, status: auth.status })
  }

  const db = getDatabase()
  const body = await request.json()
  const { action, id } = body

  if (action === 'scan') {
    // Scan workspace docs directory and index files
    // In production this would walk the actual directory
    const docs = [
      { id: 1, title: 'Sample Document', kind: 'report', file_path: '/docs/sample.md', created_at: Math.floor(Date.now() / 1000) }
    ]
    return NextResponse.json({ scanned: docs.length, docs })
  }

  if (action === 'generateThumbnail') {
    const { doc_id, file_path } = body
    // Placeholder: in production would use headless browser or converter
    db.prepare(`
      UPDATE documents SET preview_generated = 1, thumbnail_path = ? WHERE id = ?
    `).run(`/thumbnails/${doc_id}.png`, doc_id)
    return NextResponse.json({ success: true })
  }

  if (action === 'delete') {
    db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
