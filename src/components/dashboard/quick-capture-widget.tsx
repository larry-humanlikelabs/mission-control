'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMissionControl } from '@/store'

interface QuickCaptureProps {
  onCapture?: () => void
}

/**
 * Quick Capture Widget for Mission Control Dashboard
 * 
 * Floating note capture accessible via:
 * - Clicking the capture button in header
 * - Keyboard shortcut Cmd+Shift+N (from anywhere)
 * 
 * Captures notes and sends them to the Notes API.
 * Auto-suggests tags and promotion actions.
 */
export function QuickCapture({ onCapture }: QuickCaptureProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)

  // Register keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault()
        setIsOpen(prev => !prev)
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
        setContent('')
        setSuggestion(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])

  const handleSubmit = async () => {
    if (!content.trim()) return
    
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          source: 'dashboard',
          status: 'raw'
        })
      })
      
      if (res.ok) {
        const data = await res.json()
        setSuggestion(data.suggestion || 'Saved to notes')
        setContent('')
        onCapture?.()
        
        // Auto-close after 2s
        setTimeout(() => {
          setIsOpen(false)
          setSuggestion(null)
        }, 2000)
      }
    } catch (e) {
      console.error('Failed to save note:', e)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handlePromoteToTask = async () => {
    if (!content.trim()) return
    
    setIsSubmitting(true)
    try {
      // Create task directly
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: content.trim().substring(0, 100),
          description: content.trim(),
          status: 'inbox',
          priority: 'medium'
        })
      })
      
      if (res.ok) {
        setContent('')
        setSuggestion('Created as task!')
        onCapture?.()
        
        setTimeout(() => {
          setIsOpen(false)
          setSuggestion(null)
        }, 2000)
      }
    } catch (e) {
      console.error('Failed to create task:', e)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {/* Floating Capture Button */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-colors flex items-center justify-center"
        title="Quick Capture (Cmd+Shift+N)"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Capture Modal */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold text-foreground">Quick Capture</h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-3">
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Capture a thought, idea, or note..."
                className="w-full h-32 px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />

              {/* Suggestion */}
              {suggestion && (
                <div className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
                  {suggestion}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSubmit}
                  disabled={!content.trim() || isSubmitting}
                  size="sm"
                >
                  {isSubmitting ? 'Saving...' : 'Save Note'}
                </Button>
                <Button
                  onClick={handlePromoteToTask}
                  disabled={!content.trim() || isSubmitting}
                  variant="outline"
                  size="sm"
                >
                  → Create Task
                </Button>
                <span className="text-xs text-muted-foreground ml-auto">
                  Esc to close
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
