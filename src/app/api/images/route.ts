import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const db = getDatabase()
  const generations = db.prepare('SELECT * FROM generations ORDER BY created_at DESC LIMIT 100').all()
  const stats = db.prepare('SELECT COUNT(*) as count, SUM(cost_usd) as total_cost FROM generations').get()
  return NextResponse.json({ generations, stats })
}

export async function POST(request: NextRequest) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  const db = getDatabase()
  const body = await request.json()
  const { prompt, model, resolution } = body
  // In production, this would call Gemini API
  const result = db.prepare(`
    INSERT INTO generations (prompt, model, resolution, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(prompt, model || 'gemini-3.1-flash-image-preview', resolution || '1K', Math.floor(Date.now() / 1000))
  return NextResponse.json({ id: result.lastInsertRowid, status: 'pending' })
}
