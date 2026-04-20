import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getDatabase } from '@/lib/db'
import * as fs from 'fs'

/**
 * SSE endpoint: GET /api/activities/stream
 *
 * Tails the OpenClaw gateway log for activity events and broadcasts them to SSE clients.
 *
 * Gateway log format (actual):
 * [15:34:31.525] [telegram:SnakeBot] [fg1f3704] [session_spawn] subagent succeeded  delivered      2b32ac50-…  agent:main:subagent:7ebabb86-cc5f-4…  Both variants are complete.  duration=13.3s
 */

// Map gateway event types to activity types
function mapEventType(eventType: string, status: string, kind: string): { type: string; entity_type: string; description: string } {
  if (eventType === 'session_spawn') {
    if (kind === 'subagent') {
      return { type: 'agent_created', entity_type: 'agent', description: `Sub-agent spawned: ${status || 'started'}` }
    }
    return { type: 'agent_created', entity_type: 'agent', description: `Session spawned: ${eventType}` }
  }

  if (kind === 'subagent' || eventType === 'task_completed') {
    if (status === 'succeeded') {
      return { type: 'task_updated', entity_type: 'task', description: 'Sub-agent task completed' }
    }
    if (status === 'failed') {
      return { type: 'task_updated', entity_type: 'task', description: 'Sub-agent task failed' }
    }
  }

  if (kind === 'cli') {
    if (status === 'succeeded') {
      return { type: 'task_updated', entity_type: 'task', description: 'CLI task completed' }
    }
    if (status === 'failed') {
      return { type: 'task_updated', entity_type: 'task', description: 'CLI task failed' }
    }
  }

  if (eventType === 'session_update') {
    return { type: 'agent_status_change', entity_type: 'agent', description: status || 'Session updated' }
  }

  return { type: 'task_updated', entity_type: 'task', description: `${eventType}: ${status || 'unknown'}` }
}

// Check if a log line is interesting for activity tracking
function isInterestingLogLine(line: string): boolean {
  if (line.includes('[session_spawn]') ||
      line.includes('[task_completed]') ||
      line.includes('[task_failed]') ||
      line.includes('[session_update]')) {
    return true
  }
  if (line.includes('subagent succeeded') ||
      line.includes('subagent failed') ||
      line.includes('cli succeeded') ||
      line.includes('cli failed')) {
    return true
  }
  return false
}

// Parse actual gateway log line
function parseLogLine(line: string): Record<string, string | number | null> | null {
  try {
    // Extract event type from brackets
    const eventTypeMatch = line.match(/\[(session_spawn|task_completed|task_failed|session_update)\]/)
    const eventType = eventTypeMatch ? eventTypeMatch[1] : null

    // Extract status and kind
    let status: string | null = null
    let kind: string | null = null
    if (line.includes('subagent succeeded')) { status = 'succeeded'; kind = 'subagent' }
    else if (line.includes('subagent failed')) { status = 'failed'; kind = 'subagent' }
    else if (line.includes('cli succeeded')) { status = 'succeeded'; kind = 'cli' }
    else if (line.includes('cli failed')) { status = 'failed'; kind = 'cli' }

    // Extract channel
    const channelMatch = line.match(/\[([^\]]+):/)
    const channel = channelMatch ? channelMatch[1] : null

    // Extract task ID (36-char UUID in brackets)
    const taskIdMatch = line.match(/\[([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\]/)
    const taskId = taskIdMatch ? taskIdMatch[1] : null

    // Extract session ID from the "agent:main:subagent:..." format
    const sessionIdMatch = line.match(/agent:main:subagent:([a-f0-9-]+)/)
    const sessionId = sessionIdMatch ? sessionIdMatch[1] : null

    // Extract summary from the line (text after session ID)
    const summaryMatch = line.match(/agent:main:subagent:[a-f0-9-]+\s+(.+?)(?:\s+duration=|$)/)
    const summary = summaryMatch ? summaryMatch[1].trim() : null

    // Extract duration
    const durationMatch = line.match(/duration[=]?(\d+(?:\.\d+)?)/)
    const duration = durationMatch ? parseFloat(durationMatch[1]) : null

    if (!eventType && !status) return null

    return { eventType, status, kind, channel, taskId, sessionId, summary, duration }
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const workspaceId = auth.user.workspace_id ?? 1

  // Get gateway log file path
  const today = new Date().toISOString().split('T')[0]
  const logFile = `/tmp/openclaw/openclaw-${today}.log`

  // Verify log file exists
  if (!fs.existsSync(logFile)) {
    return NextResponse.json({ error: 'Gateway log not found' }, { status: 404 })
  }

  // Create SSE response
  const encoder = new TextEncoder()
  let isConnected = true

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: any) => {
        if (!isConnected) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          isConnected = false
        }
      }

      // Send initial connection event
      sendEvent({ type: 'connected', timestamp: Date.now() })

      // Track last position in log file
      let lastSize = 0
      let activityId = 0

      const tailLog = () => {
        if (!isConnected) return

        try {
          const stats = fs.statSync(logFile)
          const fileSize = stats.size

          // If file was truncated, reset
          if (fileSize < lastSize) {
            lastSize = 0
          }

          if (fileSize > lastSize) {
            // Read only new content
            const buffer = Buffer.alloc(fileSize - lastSize)
            const fd = fs.openSync(logFile, 'r')
            fs.readSync(fd, buffer, 0, buffer.length, lastSize)
            fs.closeSync(fd)

            const newContent = buffer.toString('utf8')
            lastSize = fileSize

            // Process new lines
            const newLines = newContent.split('\n').filter(l => l.trim())
            for (const line of newLines) {
              if (!isInterestingLogLine(line)) continue

              const parsed = parseLogLine(line)
              if (!parsed) continue

              const { eventType, status, kind, channel, sessionId, summary, duration } = parsed

              // Map to activity type
              const mapped = mapEventType(eventType || '', status || '', kind || '')

              const description = summary || mapped.description

              // Log to database
              try {
                const db = getDatabase()
                const stmt = db.prepare(`
                  INSERT INTO activities (type, entity_type, entity_id, actor, description, data, workspace_id, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `)
                const data = JSON.stringify({
                  taskId: parsed.taskId,
                  sessionId,
                  channel,
                  kind,
                  duration
                })
                const result = stmt.run(mapped.type, mapped.entity_type, 0, channel || 'gateway', description, data, workspaceId, Math.floor(Date.now() / 1000))
                activityId = result.lastInsertRowid as number
              } catch (e) {
                logger.warn({ error: e }, 'Failed to insert activity')
              }

              // Send to SSE
              sendEvent({
                type: mapped.type,
                entity_type: mapped.entity_type,
                entity_id: activityId,
                actor: channel || 'gateway',
                description,
                data: { taskId: parsed.taskId, sessionId, channel, kind, duration },
                created_at: Math.floor(Date.now() / 1000)
              })
            }
          }
        } catch (e) {
          logger.warn({ error: e }, 'Error tailing gateway log')
        }
      }

      // Poll every 2 seconds for log changes
      const interval = setInterval(tailLog, 2000)

      // Cleanup on disconnect
      request.signal.addEventListener('abort', () => {
        isConnected = false
        clearInterval(interval)
        controller.close()
      })
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
