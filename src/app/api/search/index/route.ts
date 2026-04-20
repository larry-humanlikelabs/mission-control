import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { readLimiter } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { searchIndex, type SearchResult } from '@/lib/search-indexer'

// Group results by source type
function groupBySourceType(results: SearchResult[]): Record<string, SearchResult[]> {
  const grouped: Record<string, SearchResult[]> = {}
  for (const r of results) {
    if (!grouped[r.source_type]) grouped[r.source_type] = []
    grouped[r.source_type].push(r)
  }
  return grouped
}

// Source type display metadata
const SOURCE_META: Record<string, { label: string; badge: string; icon: string }> = {
  memory:       { label: 'Memory',      badge: 'MEM', icon: '🧠' },
  conversation: { label: 'Conversation', badge: 'CNV', icon: '💬' },
  activity:     { label: 'Activity',    badge: 'ACT', icon: '⚡' },
  doc:          { label: 'Document',   badge: 'DOC', icon: '📄' },
  task:         { label: 'Task',       badge: 'TSK', icon: '☑️' },
}

export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = readLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

    if (!q || q.length < 2) {
      return NextResponse.json({ error: 'Query too short (min 2 chars)' }, { status: 400 })
    }

    if (q.length > 500) {
      return NextResponse.json({ error: 'Query too long (max 500 chars)' }, { status: 400 })
    }

    logger.info({ q, limit }, 'Search API: query received')

    const results = await searchIndex(q, limit)
    const grouped = groupBySourceType(results)

    // Attach source metadata
    const groupedWithMeta = Object.fromEntries(
      Object.entries(grouped).map(([type, items]) => [
        type,
        {
          meta: SOURCE_META[type] ?? { label: type, badge: type.slice(0, 3).toUpperCase(), icon: '📎' },
          items,
        },
      ])
    )

    const totalCount = results.length
    const hasEmbeddings = Boolean(process.env.OPENAI_API_KEY)

    return NextResponse.json({
      query: q,
      total: totalCount,
      has_embeddings: hasEmbeddings,
      grouped: groupedWithMeta,
    })
  } catch (err: any) {
    logger.error({ err }, 'Search API: unexpected error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
