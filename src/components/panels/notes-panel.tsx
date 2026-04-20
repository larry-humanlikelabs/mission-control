'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useMissionControl } from '@/store'

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

interface Suggestion {
  type: 'keep' | 'task' | 'memory' | 'project'
  confidence: number
  reason: string
}

const STATUS_TABS = [
  { key: 'all', labelKey: 'allNotes' },
  { key: 'raw', labelKey: 'raw' },
  { key: 'triaged', labelKey: 'triaged' },
  { key: 'promoted', labelKey: 'promoted' },
  { key: 'archived', labelKey: 'archived' },
]

const SOURCE_ICONS: Record<string, string> = {
  web: '🌐',
  telegram: '✈️',
  voice: '🎙️',
  felix: '⚡',
  api: '🔌',
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts * 1000)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function getTagColor(tag: string): string {
  const t = tag.toLowerCase()
  if (t === 'action' || t === 'urgent') return 'bg-red-500/20 text-red-400 border-red-500/30'
  if (t === 'memory' || t === 'insight') return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
  if (t === 'project') return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  if (t === 'idea') return 'bg-green-500/20 text-green-400 border-green-500/30'
  if (t === 'link') return 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30'
  if (t === 'question') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  return 'bg-muted-foreground/10 text-muted-foreground border-muted-foreground/20'
}

export function NotesPanel() {
  const t = useTranslations('notes')
  const { currentUser } = useMissionControl()
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('all')
  const [captureText, setCaptureText] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [lastCreated, setLastCreated] = useState<Note | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editText, setEditText] = useState('')

  const fetchNotes = useCallback(async () => {
    try {
      const url = activeTab === 'all' ? '/api/notes' : `/api/notes?status=${activeTab}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch notes')
      const data = await res.json()
      setNotes(data.notes || [])
    } catch (err) {
      console.error('Failed to fetch notes:', err)
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const handleCapture = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!captureText.trim() || capturing) return

    setCapturing(true)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: captureText.trim(),
          source: 'web',
        }),
      })
      if (!res.ok) throw new Error('Failed to create note')
      const data = await res.json()
      setLastCreated(data.note)
      setCaptureText('')
      await fetchNotes()
    } catch (err) {
      console.error('Failed to create note:', err)
    } finally {
      setCapturing(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this note?')) return
    try {
      const res = await fetch('/api/notes', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error('Failed to delete')
      await fetchNotes()
    } catch (err) {
      console.error('Failed to delete note:', err)
    }
  }

  const handleAcceptSuggestion = async (note: Note, suggestion: Suggestion) => {
    try {
      if (suggestion.type === 'task') {
        // Create a task from the note
        const res = await fetch('/api/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: note.content.slice(0, 100),
            description: note.content,
            source: 'notes',
            tags: note.tags,
          }),
        })
        if (!res.ok) throw new Error('Failed to create task')
        const data = await res.json()
        // Update note status
        await fetch('/api/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: note.id,
            status: 'promoted',
            promoted_to: JSON.stringify({ type: 'task', target_id: data.task?.id }),
          }),
        })
      } else if (suggestion.type === 'memory') {
        // Mark as triaged
        await fetch('/api/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: note.id, status: 'triaged' }),
        })
      } else {
        // Mark as triaged
        await fetch('/api/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: note.id, status: 'triaged' }),
        })
      }
      await fetchNotes()
    } catch (err) {
      console.error('Failed to apply suggestion:', err)
    }
  }

  const handleUpdateStatus = async (id: number, status: string) => {
    try {
      await fetch('/api/notes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      await fetchNotes()
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-8 w-48 bg-surface-1 rounded" />
          <div className="h-24 bg-surface-1 rounded" />
          <div className="h-24 bg-surface-1 rounded" />
          <div className="h-24 bg-surface-1 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-border flex-shrink-0">
        <h2 className="text-xl font-bold text-foreground">{t('title', { default: 'Notes' })}</h2>
        <button
          onClick={fetchNotes}
          className="text-muted-foreground hover:text-foreground text-xs flex items-center gap-1"
          title="Refresh"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1.5 8a6.5 6.5 0 0 1 11.25-4.5M14.5 8a6.5 6.5 0 0 1-11.25 4.5" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Floating capture box */}
      <div className="px-4 py-3 border-b border-border bg-surface-0">
        <form onSubmit={handleCapture}>
          <div className="flex gap-2">
            <textarea
              value={captureText}
              onChange={(e) => setCaptureText(e.target.value)}
              placeholder={t('capturePlaceholder', { default: 'Capture a thought… (Cmd+Shift+N)' })}
              rows={2}
              className="flex-1 bg-surface-1 text-foreground border border-border rounded-lg px-3 py-2 text-sm placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50"
              disabled={capturing}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  handleCapture(e as any)
                }
              }}
            />
            <button
              type="submit"
              disabled={!captureText.trim() || capturing}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {capturing ? '…' : t('capture', { default: 'Capture' })}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">⌘⇧N to open · ⌘↵ to capture</p>
        </form>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 px-4 pt-3 pb-2 border-b border-border/40">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-1'
            }`}
          >
            {tab.labelKey === 'allNotes' ? 'All' : tab.labelKey.charAt(0).toUpperCase() + tab.labelKey.slice(1)}
            {tab.key !== 'all' && (
              <span className="ml-1.5 text-[10px] opacity-60">
                {notes.filter(n => n.status === tab.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Notes feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/30">
            <svg className="w-12 h-12 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12h6M12 9v6" strokeLinecap="round" />
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
            <p className="text-sm">No notes yet. Capture something!</p>
          </div>
        ) : (
          notes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              onDelete={() => handleDelete(note.id)}
              onUpdateStatus={(status) => handleUpdateStatus(note.id, status)}
              onAcceptSuggestion={(s) => handleAcceptSuggestion(note, s)}
            />
          ))
        )}
      </div>

      {/* Last created confirmation */}
      {lastCreated && (
        <div className="fixed bottom-4 right-4 bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 px-4 py-2 rounded-lg text-sm flex items-center gap-2 shadow-lg animate-[fade-in_0.3s_ease]">
          <span>✓</span>
          <span>Note captured</span>
          {lastCreated.tags.length > 0 && (
            <span className="text-[10px] opacity-70">{lastCreated.tags.join(', ')}</span>
          )}
          <button
            onClick={() => setLastCreated(null)}
            className="ml-2 text-emerald-400/60 hover:text-emerald-400"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Note Card ────────────────────────────────────────────────────────────────

function NoteCard({
  note,
  onDelete,
  onUpdateStatus,
  onAcceptSuggestion,
}: {
  note: Note
  onDelete: () => void
  onUpdateStatus: (status: string) => void
  onAcceptSuggestion: (s: Suggestion) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showSuggestion, setShowSuggestion] = useState(note.status === 'raw')

  // Auto-triage: infer suggestion from tags/content
  const suggestion: Suggestion = inferSuggestion(note)

  const isLong = note.content.length > 200
  const displayContent = expanded || !isLong ? note.content : note.content.slice(0, 200) + '…'

  return (
    <div className="bg-card border border-border/60 rounded-xl p-4 hover:border-border transition-colors group">
      {/* Meta row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{SOURCE_ICONS[note.source] || '📝'}</span>
          <span>{formatTimestamp(note.captured_at)}</span>
          {note.source !== 'api' && (
            <span className="uppercase font-mono opacity-60">{note.source}</span>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Status badge */}
          {note.status !== 'archived' && (
            <button
              onClick={() => onUpdateStatus('archived')}
              className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface-1 transition-colors"
              title="Archive"
            >
              📦
            </button>
          )}
          {note.status === 'archived' && (
            <button
              onClick={() => onUpdateStatus('raw')}
              className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface-1 transition-colors"
              title="Restore"
            >
              ↩
            </button>
          )}
          <button
            onClick={onDelete}
            className="text-[10px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            🗑
          </button>
        </div>
      </div>

      {/* Content */}
      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
        {displayContent}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-muted-foreground hover:text-foreground mt-1"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {note.tags.map((tag, i) => (
            <span key={i} className={`text-[10px] px-1.5 py-0.5 rounded-full border font-medium ${getTagColor(tag)}`}>
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Promotion suggestion pill */}
      {note.status === 'raw' && suggestion && suggestion.confidence >= 0.60 && (
        <div className="mt-3 flex items-center gap-2">
          <div className={`text-[10px] px-2 py-1 rounded-full border ${
            suggestion.type === 'task' ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' :
            suggestion.type === 'memory' ? 'bg-purple-500/15 text-purple-400 border-purple-500/25' :
            'bg-surface-1 text-muted-foreground border-border'
          }`}>
            💡 {suggestion.reason} <span className="opacity-60">({Math.round(suggestion.confidence * 100)}%)</span>
          </div>
          <button
            onClick={() => onAcceptSuggestion(suggestion)}
            className="text-[10px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
          >
            Apply
          </button>
          <button
            onClick={() => setShowSuggestion(false)}
            className="text-[10px] text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Promoted indicator */}
      {note.status === 'promoted' && note.promoted_to && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          ↑ Promoted to {note.promoted_to.type} #{note.promoted_to.target_id}
        </div>
      )}
    </div>
  )
}

// ─── Auto-triage suggestion inference ────────────────────────────────────────

const TASK_SIGNALS = ['build', 'create', 'fix', 'update', 'add', 'remove', 'implement', 'design', 'write', 'ship', 'deploy', 'test', 'check', 'research', 'analyze', 'need to', 'should', 'todo', 'task']
const MEMORY_SIGNALS = ['remember', 'learned', 'insight', 'pattern', 'preference', 'context', 'key takeaway', 'important', 'worth noting']

function inferSuggestion(note: Note): Suggestion | null {
  const lower = note.content.toLowerCase()
  const wordCount = note.content.split(/\s+/).length

  // High-confidence task signals
  if (TASK_SIGNALS.some(s => lower.includes(s)) && wordCount < 50) {
    return { type: 'task', confidence: 0.85, reason: 'Looks actionable — make a task?' }
  }
  if (lower.startsWith('build') || lower.startsWith('create') || lower.startsWith('fix')) {
    return { type: 'task', confidence: 0.90, reason: 'Action item detected — create a task?' }
  }

  // High-confidence memory signals
  if (MEMORY_SIGNALS.some(s => lower.includes(s))) {
    return { type: 'memory', confidence: 0.83, reason: 'Worth remembering — save to memory?' }
  }

  // Medium confidence: short + action-ish
  if (wordCount < 20 && TASK_SIGNALS.some(s => lower.includes(s))) {
    return { type: 'task', confidence: 0.70, reason: 'Quick action — create a task?' }
  }

  return null
}
