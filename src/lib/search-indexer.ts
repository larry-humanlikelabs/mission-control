/**
 * search-indexer.ts — Incremental vector indexer for Mission Control Global Search
 *
 * Runs every 10 minutes via scheduler. Chunks memories, conversations, docs,
 * and activity events (~500 tokens/chunk), embeds with text-embedding-3-small,
 * and stores in the search_index table.
 *
 * Fallback: if OPENAI_API_KEY is not set, stores text without embedding for
 * basic LIKE-based search.
 */

import { getDatabase } from './db'
import { logger } from './logger'
import { config } from './config'
import { join, basename } from 'path'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { createHash } from 'crypto'

const CHUNK_SIZE = 500 // approximate token count target
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIM = 1536
const RATE_LIMIT_PER_MIN = 500

interface IndexedSource {
  source_type: string
  source_path: string
}

interface IndexResult {
  ok: boolean
  indexed: number
  skipped: number
  errors: string[]
  duration_ms: number
  embedding_cost_usd?: number
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

function chunkText(text: string, targetTokens = CHUNK_SIZE): string[] {
  // Rough token estimate: 1 token ≈ 4 chars for English
  const charsPerChunk = targetTokens * 4
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    let end = start + charsPerChunk
    if (end >= text.length) {
      chunks.push(text.slice(start).trim())
      break
    }
    // Try to break at sentence or paragraph boundary
    let breakPoint = text.lastIndexOf('\n\n', end)
    if (breakPoint <= start) breakPoint = text.lastIndexOf('. ', end)
    if (breakPoint <= start) breakPoint = text.lastIndexOf(' ', end)
    if (breakPoint <= start) breakPoint = end
    chunks.push(text.slice(start, breakPoint + 1).trim())
    start = breakPoint + 1
  }
  return chunks.filter(c => c.length > 20)
}

function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

// ---------------------------------------------------------------------------
// Source discovery
// ---------------------------------------------------------------------------

function* walkDir(dir: string, extensions?: string[]): Generator<string> {
  if (!existsSync(dir)) return
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        yield* walkDir(full, extensions)
      } else if (entry.isFile()) {
        if (!extensions || extensions.some(ext => entry.name.endsWith(ext))) {
          yield full
        }
      }
    }
  } catch {
    // Skip inaccessible dirs
  }
}

function discoverSources(): IndexedSource[] {
  const sources: IndexedSource[] = []
  const openclawHome = config.openclawHome || process.env.OPENCLAW_HOME || join(process.env.HOME || '/root', '.openclaw')

  // Memories
  const memoriesDirs = [
    join(openclawHome, 'agents'),
    join(openclawHome, 'workspace'),
    join(openclawHome, 'workspace', 'memory'),
  ]
  for (const dir of memoriesDirs) {
    for (const file of walkDir(dir, ['.md', '.txt'])) {
      sources.push({ source_type: 'memory', source_path: file })
    }
  }

  // Conversation messages
  const sessionsDir = join(openclawHome, 'agents')
  if (existsSync(sessionsDir)) {
    try {
      for (const agentDir of readdirSync(sessionsDir, { withFileTypes: true })) {
        if (!agentDir.isDirectory()) continue
        const sessionsDir2 = join(sessionsDir, agentDir.name, 'sessions')
        if (!existsSync(sessionsDir2)) continue
        for (const file of walkDir(sessionsDir2, ['.jsonl'])) {
          sources.push({ source_type: 'conversation', source_path: file })
        }
      }
    } catch {}
  }

  // Activity events from DB
  sources.push({ source_type: 'activity', source_path: ':activity_events:' })

  // Docs
  const docsDirs = [
    join(openclawHome, 'workspace', 'docs'),
    join(openclawHome, 'docs'),
  ]
  for (const dir of docsDirs) {
    for (const file of walkDir(dir, ['.md', '.txt', '.html'])) {
      sources.push({ source_type: 'doc', source_path: file })
    }
  }

  return sources
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function extractContent(source: IndexedSource): { content: string; modified_at: number } | null {
  try {
    if (source.source_type === 'activity') {
      return null // handled separately from DB
    }
    const stat = statSync(source.source_path)
    const content = readFileSync(source.source_path, 'utf-8')
    return { content, modified_at: Math.floor(stat.mtimeMs / 1000) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// OpenAI Embedding
// ---------------------------------------------------------------------------

async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  const embeddings: number[][] = []
  let batchCount = 0

  for (let i = 0; i < texts.length; i += RATE_LIMIT_PER_MIN) {
    batchCount++
    const batch = texts.slice(i, i + RATE_LIMIT_PER_MIN)
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: batch,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`OpenAI embedding API error ${response.status}: ${err}`)
    }

    const data = await response.json() as { data: Array<{ embedding: number[] }> }
    for (const item of data.data) {
      embeddings.push(item.embedding)
    }

    // Rate limit: 500/min, so wait if we hit a full batch
    if (i + RATE_LIMIT_PER_MIN < texts.length) {
      await new Promise(r => setTimeout(r, 65_000))
    }
  }

  return embeddings
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export { cosineSimilarity }

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

function getLastIndexed(sourcePath: string): number | null {
  const db = getDatabase()
  const row = db.prepare(
    'SELECT MAX(indexed_at) as ts FROM search_index WHERE source_path = ?'
  ).get(sourcePath) as { ts: number | null } | undefined
  return row?.ts ?? null
}

function upsertChunks(
  source: IndexedSource,
  chunks: string[],
  embeddings: number[][] | null,
  modifiedAt: number
): number {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  // Delete existing chunks for this source (incremental re-index)
  db.prepare('DELETE FROM search_index WHERE source_path = ?').run(source.source_path)

  const insert = db.prepare(`
    INSERT INTO search_index (content, source_type, source_path, chunk_index, embedding, content_hash, indexed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let indexed = 0
  const insertMany = db.transaction((chs: string[], embs: number[][] | null) => {
    for (let i = 0; i < chs.length; i++) {
      const embeddingBlob = embs && embs[i]
        ? Buffer.from(new Float32Array(embs[i]).buffer)
        : null
      const hash = contentHash(chs[i])
      insert.run(chs[i], source.source_type, source.source_path, i, embeddingBlob, hash, now, now)
      indexed++
    }
  })

  insertMany(chunks, embeddings)
  return indexed
}

function indexActivityEvents(): number {
  const db = getDatabase()
  const lastIndexed = getLastIndexed(':activity_events:')
  const since = lastIndexed ? lastIndexed - 60 : Math.floor(Date.now() / 1000) - 86400

  const rows = db.prepare(`
    SELECT id, type, entity_type, actor, description, data, created_at
    FROM activities
    WHERE created_at >= ?
    ORDER BY created_at ASC
    LIMIT 5000
  `).all(since) as Array<{
    id: number
    type: string
    entity_type: string
    actor: string
    description: string
    data?: string
    created_at: number
  }>

  if (rows.length === 0) return 0

  const chunks = rows.map(r => {
    const dataStr = r.data ? ` [Data: ${r.data}]` : ''
    return `[${r.type}] ${r.actor}: ${r.description}${dataStr}`
  })

  const now = Math.floor(Date.now() / 1000)
  db.prepare('DELETE FROM search_index WHERE source_path = ?').run(':activity_events:')

  const insert = db.prepare(`
    INSERT INTO search_index (content, source_type, source_path, chunk_index, embedding, content_hash, indexed_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let indexed = 0
  const insertMany = db.transaction((chs: string[]) => {
    for (let i = 0; i < chs.length; i++) {
      const hash = contentHash(chs[i])
      insert.run(chs[i], 'activity', ':activity_events:', i, null, hash, now, now)
      indexed++
    }
  })

  insertMany(chunks)
  return indexed
}

// ---------------------------------------------------------------------------
// Main indexer run
// ---------------------------------------------------------------------------

export async function runSearchIndexer(): Promise<IndexResult> {
  const start = Date.now()
  const errors: string[] = []
  let indexed = 0
  let skipped = 0

  const apiKey = process.env.OPENAI_API_KEY || ''
  const hasEmbedding = Boolean(apiKey)

  logger.info({ hasEmbedding }, 'Search indexer: starting run')

  // Ensure meta table has last_indexed record
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)

  const sources = discoverSources()
  logger.info({ count: sources.length }, 'Search indexer: discovered sources')

  // Collect all texts + embeddings
  const allTexts: string[] = []
  const sourceMap: Array<{ source: IndexedSource; chunkIdx: number; modifiedAt: number }> = []

  for (const source of sources) {
    if (source.source_type === 'activity') {
      // Handled separately
      continue
    }

    const extracted = extractContent(source)
    if (!extracted) continue

    const hash = contentHash(extracted.content)
    const lastIdx = getLastIndexed(source.source_path)

    if (lastIdx && lastIdx >= extracted.modified_at) {
      skipped++
      continue
    }

    const chunks = chunkText(extracted.content)
    for (let i = 0; i < chunks.length; i++) {
      allTexts.push(chunks[i])
      sourceMap.push({ source, chunkIdx: i, modifiedAt: extracted.modified_at })
    }
  }

  // Embed in batches
  let embeddings: number[][] | null = null
  if (hasEmbedding && allTexts.length > 0) {
    try {
      embeddings = await embedTexts(allTexts, apiKey)
    } catch (err: any) {
      errors.push(`Embedding failed: ${err.message}`)
      logger.error({ err }, 'Search indexer: embedding failed')
    }
  }

  // Store chunks
  const insertBySource = db.transaction(() => {
    for (let i = 0; i < sourceMap.length; i++) {
      const { source, chunkIdx, modifiedAt } = sourceMap[i]
      const chunkText = allTexts[i]
      const embedding = embeddings ? embeddings[i] : null
      const hash = contentHash(chunkText)
      const insert = db.prepare(`
        INSERT INTO search_index (content, source_type, source_path, chunk_index, embedding, content_hash, indexed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const embeddingBlob = embedding ? Buffer.from(new Float32Array(embedding).buffer) : null
      insert.run(chunkText, source.source_type, source.source_path, chunkIdx, embeddingBlob, hash, now, now)
      indexed++
    }
  })

  try {
    insertBySource()
  } catch (err: any) {
    errors.push(`DB insert failed: ${err.message}`)
  }

  // Index activity events (always re-index recent)
  try {
    const actIndexed = indexActivityEvents()
    indexed += actIndexed
  } catch (err: any) {
    errors.push(`Activity index failed: ${err.message}`)
  }

  // Update meta
  try {
    db.prepare('INSERT OR REPLACE INTO search_index_meta (key, value) VALUES (?, ?)').run('last_full_run', String(now))
  } catch {}

  const duration_ms = Date.now() - start

  // Estimate embedding cost: ~0.02/1M tokens for ada-002, text-embedding-3-small is same price
  const embeddingCostUsd = embeddings
    ? (allTexts.join(' ').length / 4) * 0.02 / 1_000_000
    : undefined

  logger.info({ indexed, skipped, errors: errors.length, duration_ms }, 'Search indexer: run complete')

  return { ok: errors.length === 0, indexed, skipped, errors, duration_ms, embedding_cost_usd: embeddingCostUsd }
}

// ---------------------------------------------------------------------------
// Search API helpers
// ---------------------------------------------------------------------------

export interface SearchResult {
  id: number
  content: string
  source_type: string
  source_path: string
  chunk_index: number
  similarity: number
}

export async function searchIndex(query: string, limit = 20): Promise<SearchResult[]> {
  const db = getDatabase()

  // Without embedding: fallback to LIKE search
  if (!process.env.OPENAI_API_KEY) {
    const likeQuery = `%${query.replace(/[%_]/g, '\\$&')}%`
    const rows = db.prepare(`
      SELECT id, content, source_type, source_path, chunk_index
      FROM search_index
      WHERE content LIKE ?
      ORDER BY indexed_at DESC
      LIMIT ?
    `).all(likeQuery, limit) as Array<{ id: number; content: string; source_type: string; source_path: string; chunk_index: number }>

    return rows.map(r => ({ ...r, similarity: 1.0 }))
  }

  // Embed query
  let queryEmbedding: number[] | null = null
  try {
    const resp = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: query }),
    })
    if (resp.ok) {
      const data = await resp.json() as { data: Array<{ embedding: number[] }> }
      queryEmbedding = data.data[0]?.embedding ?? null
    }
  } catch {}

  if (!queryEmbedding) {
    // Fallback to text search
    const likeQuery = `%${query.replace(/[%_]/g, '\\$&')}%`
    const rows = db.prepare(`
      SELECT id, content, source_type, source_path, chunk_index
      FROM search_index
      WHERE content LIKE ?
      ORDER BY indexed_at DESC
      LIMIT ?
    `).all(likeQuery, limit) as Array<{ id: number; content: string; source_type: string; source_path: string; chunk_index: number }>

    return rows.map(r => ({ ...r, similarity: 1.0 }))
  }

  // Cosine similarity search — load all with embeddings and score
  const rows = db.prepare(`
    SELECT id, content, source_type, source_path, chunk_index, embedding
    FROM search_index
    WHERE embedding IS NOT NULL
  `).all() as Array<{ id: number; content: string; source_type: string; source_path: string; chunk_index: number; embedding: Buffer | null }>

  const scored = rows
    .map(row => {
      if (!row.embedding) return { ...row, similarity: 0 }
      const emb = new Float32Array(row.embedding.buffer)
      const vec = Array.from(emb)
      return { ...row, embedding: undefined as unknown as Buffer, similarity: cosineSimilarity(queryEmbedding!, vec) }
    })
    .filter(r => r.similarity > 0.1)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)

  return scored
}
