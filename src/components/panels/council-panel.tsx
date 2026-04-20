'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'

interface CouncilFinding {
  number: number
  title: string
  priority: number
  raised_by: string
  why_it_matters: string
  recommended_action: string
  data_evidence: string[]
  confidence: number
}

interface CouncilRun {
  date: string
  findings: CouncilFinding[]
  agents_run: string[]
  duration_ms: number
}

export function CouncilPanel() {
  const [runs, setRuns] = useState<CouncilRun[]>([])
  const [currentRun, setCurrentRun] = useState<CouncilRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)

  useEffect(() => { fetchRuns() }, [])

  const fetchRuns = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/council')
      if (res.ok) {
        const data = await res.json()
        setRuns(data.runs || [])
        if (data.runs?.length > 0) setCurrentRun(data.runs[0])
      }
    } catch (e) { console.error('Failed to fetch council:', e) }
    setLoading(false)
  }

  const runCouncil = async () => {
    setRunning(true)
    try {
      await fetch('/api/council', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' })
      })
      fetchRuns()
    } catch (e) { console.error('Failed to run council:', e) }
    setRunning(false)
  }

  const priorityColors = ['', 'text-red-500', 'text-orange-500', 'text-yellow-500', 'text-blue-500', 'text-muted-foreground']
  const priorityLabels = ['', '🔴 Critical', '🟠 High', '🟡 Medium', '🔵 Low', '⚪ Awareness']

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="text-lg font-semibold">Business Advisory Council</h2>
        <Button onClick={runCouncil} size="sm" disabled={running}>
          {running ? '⏳ Running...' : '▶ Run Council'}
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : currentRun ? (
          <div className="space-y-6">
            {/* Current run summary */}
            <div className="bg-primary/10 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">📊 {currentRun.date}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {currentRun.findings.length} findings • {currentRun.agents_run.length} agents • {currentRun.duration_ms}ms
                  </p>
                </div>
                {runs.length > 1 && (
                  <select
                    onChange={e => setCurrentRun(runs[parseInt(e.target.value)])}
                    className="bg-background px-3 py-1 rounded-lg border text-sm"
                  >
                    {runs.map((run, i) => (
                      <option key={i} value={i}>{run.date}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Findings */}
            <div className="space-y-3">
              {currentRun.findings.map(finding => (
                <div key={finding.number} className="bg-card rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center font-bold">
                      {finding.number}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`font-medium ${priorityColors[finding.priority]}`}>
                          {priorityLabels[finding.priority]}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-muted rounded-full">
                          {finding.raised_by.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {Math.round(finding.confidence * 100)}% confidence
                        </span>
                      </div>
                      <p className="font-medium mb-2">{finding.title}</p>
                      <p className="text-sm text-muted-foreground mb-2">{finding.why_it_matters}</p>
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs font-medium mb-1">Recommended Action</p>
                        <p className="text-sm">{finding.recommended_action}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium">No council runs yet</p>
            <p className="text-sm mt-1">Click "Run Council" to generate your first advisory brief</p>
          </div>
        )}
      </div>
    </div>
  )
}
