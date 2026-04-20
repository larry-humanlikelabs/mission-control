import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { logger } from '@/lib/logger'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8537161005:AAH_VCyGZxaDWTAooTsa_wQPSbg0CSv-vmQ'
const MISSION_CONTROL_CHAT_ID = process.env.MISSION_CONTROL_CHAT_ID || '5280832041'

/**
 * POST /api/notes/telegram
 * Telegram webhook — receives messages from the #notes topic and creates notes.
 * Body: { message: { text, from: { id, username, first_name }, date } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate Telegram update structure
    if (!body.message || !body.message.text) {
      return NextResponse.json({ ok: true })
    }

    const { text, from } = body.message
    const username = from?.username || from?.first_name || 'unknown'
    const workspaceId = 1 // TODO: multi-tenant routing based on chat_id

    // Quick triage: infer tags and suggest promotion
    const tags = inferTags(text)
    const suggestion = suggestPromotion(text)

    const db = getDatabase()
    const stmt = db.prepare(`
      INSERT INTO notes (content, captured_at, source, workspace_id, tags, status)
      VALUES (?, ?, 'telegram', ?, 'raw', ?)
    `)

    const capturedAt = body.message.date || Math.floor(Date.now() / 1000)
    const result = stmt.run(
      text,
      capturedAt,
      workspaceId,
      JSON.stringify(tags)
    )

    const noteId = result.lastInsertRowid

    // Confirm receipt back to the user
    const confirmText = `📝 Note captured! ${suggestion.type === 'task' ? '→ Suggested: make a task' : suggestion.type === 'memory' ? '→ Suggested: save as memory' : ''}`

    await sendTelegramMessage(confirmText, username)

    logger.info({ noteId, username, source: 'telegram' }, 'Note created from Telegram')

    return NextResponse.json({
      ok: true,
      noteId,
      suggestion: { ...suggestion, noteId }
    })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/notes/telegram error')
    return NextResponse.json({ error: 'Failed to process Telegram note' }, { status: 500 })
  }
}

async function sendTelegramMessage(text: string, replyToUsername?: string): Promise<void> {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: MISSION_CONTROL_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    })
  } catch (error) {
    logger.warn({ err: error }, 'Failed to send Telegram confirmation')
  }
}

const TASK_KEYWORDS = ['build', 'create', 'fix', 'update', 'add', 'remove', 'implement', 'design', 'write', 'ship', 'deploy', 'test']
const MEMORY_KEYWORDS = ['remember', 'learned', 'insight', 'pattern', 'preference', 'context']

function inferTags(content: string): string[] {
  const lower = content.toLowerCase()
  const tags: string[] = []
  if (TASK_KEYWORDS.some(k => lower.includes(k))) tags.push('action')
  if (MEMORY_KEYWORDS.some(k => lower.includes(k))) tags.push('memory')
  if (lower.includes('urgent') || lower.includes('asap')) tags.push('urgent')
  if (lower.includes('link') || lower.includes('http')) tags.push('link')
  return tags.slice(0, 3)
}

function suggestPromotion(content: string) {
  const lower = content.toLowerCase()
  if (TASK_KEYWORDS.some(k => lower.startsWith(k))) {
    return { type: 'task', confidence: 0.85, reason: 'Looks like a to-do' }
  }
  if (MEMORY_KEYWORDS.some(k => lower.includes(k))) {
    return { type: 'memory', confidence: 0.82, reason: 'Worth remembering' }
  }
  return { type: 'keep', confidence: 0.60, reason: 'Saved as note' }
}
