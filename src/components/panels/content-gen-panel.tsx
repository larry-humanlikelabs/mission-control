'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface Idea {
  id: number
  topic: string
  hook: string
  angle: string
  confidence_tier: string
  status: string
}

export function ContentGenPanel() {
  const [activeTab, setActiveTab] = useState<'ideas' | 'generate' | 'prompts'>('ideas')
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [generating, setGenerating] = useState(false)
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null)

  useEffect(() => { fetchIdeas() }, [])

  const fetchIdeas = async () => {
    try {
      const res = await fetch('/api/ideas')
      if (res.ok) setIdeas((await res.json()).ideas || [])
    } catch (e) { console.error('Failed to fetch ideas:', e) }
  }

  const generateIdeas = async () => {
    setGenerating(true)
    try {
      await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate' })
      })
      fetchIdeas()
    } catch (e) { console.error('Failed to generate ideas:', e) }
    setGenerating(false)
  }

  const approveIdea = async (id: number) => {
    try {
      await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', id })
      })
      fetchIdeas()
    } catch (e) { console.error('Failed to approve:', e) }
  }

  const rejectIdea = async (id: number) => {
    try {
      await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', id })
      })
      fetchIdeas()
    } catch (e) { console.error('Failed to reject:', e) }
  }

  const confidenceColors: Record<string, string> = {
    a: 'text-green-500',
    b: 'text-yellow-500',
    c: 'text-orange-500'
  }

  const confidenceLabels: Record<string, string> = {
    a: '🟢 High Confidence',
    b: '🟡 Medium',
    c: '🟠 Low'
  }

  const pendingIdeas = ideas.filter(i => i.status === 'pending')
  const approvedIdeas = ideas.filter(i => i.status === 'approved')

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="text-lg font-semibold">Content Generation</h2>
        <Button onClick={generateIdeas} size="sm" disabled={generating}>
          {generating ? '⏳ Generating...' : '🎯 Generate Ideas'}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {(['ideas', 'generate', 'prompts'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize ${
              activeTab === tab
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'ideas' && (
          <div className="space-y-6">
            {/* Pending Review */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Review ({pendingIdeas.length})
              </h3>
              {pendingIdeas.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No ideas pending review</p>
                  <p className="text-xs mt-1">Click "Generate Ideas" to create new content</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingIdeas.map(idea => (
                    <div key={idea.id} className="bg-card rounded-xl border p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex-1">
                          <p className="font-medium">{idea.hook}</p>
                          <p className="text-sm text-muted-foreground mt-1">{idea.angle}</p>
                          <div className="flex items-center gap-2 mt-2">
                            <span className={`text-xs ${confidenceColors[idea.confidence_tier]}`}>
                              {confidenceLabels[idea.confidence_tier]}
                            </span>
                            <span className="text-xs px-2 py-0.5 bg-muted rounded-full">
                              {idea.topic}
                            </span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={() => approveIdea(idea.id)} size="sm" className="bg-green-500 hover:bg-green-600">
                            ✓ Approve
                          </Button>
                          <Button onClick={() => rejectIdea(idea.id)} size="sm" variant="outline">
                            ✗ Reject
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Approved / Pipeline */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">
                Idea Bank ({approvedIdeas.length})
              </h3>
              {approvedIdeas.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No approved ideas yet</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {approvedIdeas.map(idea => (
                    <div
                      key={idea.id}
                      className="bg-card rounded-xl border p-3 cursor-pointer hover:border-primary/50"
                      onClick={() => {
                        setSelectedIdea(idea)
                        setActiveTab('generate')
                      }}
                    >
                      <p className="font-medium text-sm">{idea.hook}</p>
                      <p className="text-xs text-muted-foreground mt-1">{idea.angle}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`text-xs ${confidenceColors[idea.confidence_tier]}`}>
                          {idea.confidence_tier.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'generate' && (
          <div className="space-y-4">
            <div className="bg-card rounded-xl border p-4">
              <h3 className="font-medium mb-3">Generate Content</h3>
              {selectedIdea ? (
                <div>
                  <p className="text-sm text-muted-foreground">Selected idea:</p>
                  <p className="font-medium mt-1">{selectedIdea.hook}</p>
                  <p className="text-sm text-muted-foreground mt-1">{selectedIdea.angle}</p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select an approved idea from the Ideas tab to generate content
                </p>
              )}

              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground">Format</label>
                  <div className="flex gap-2 mt-1">
                    {['Long-form', 'Short', 'Thread', 'LinkedIn'].map(fmt => (
                      <button
                        key={fmt}
                        className="px-3 py-1.5 rounded-lg border text-sm hover:bg-muted"
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Platform</label>
                  <div className="flex gap-2 mt-1">
                    {['YouTube', 'X', 'LinkedIn', 'Newsletter', 'Instagram'].map(plt => (
                      <button
                        key={plt}
                        className="px-3 py-1.5 rounded-lg border text-sm hover:bg-muted"
                      >
                        {plt}
                      </button>
                    ))}
                  </div>
                </div>
                <Button className="w-full" disabled={!selectedIdea}>
                  🎬 Generate Script + Social Cascade
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'prompts' && (
          <div className="space-y-4">
            <div className="bg-card rounded-xl border p-4">
              <h3 className="font-medium mb-3">Prompt Library</h3>
              <p className="text-sm text-muted-foreground">
                Customize the prompts used for content generation. Changes are versioned.
              </p>
              <div className="mt-4 space-y-3">
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs font-medium">Script Generator</p>
                  <p className="text-xs text-muted-foreground mt-1">Used to generate YouTube/video scripts</p>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs font-medium">Social Cascade</p>
                  <p className="text-xs text-muted-foreground mt-1">Repurposes long-form into X/LinkedIn/IG</p>
                </div>
                <div className="p-3 bg-muted/50 rounded-lg">
                  <p className="text-xs font-medium">Thumbnail Brief</p>
                  <p className="text-xs text-muted-foreground mt-1">Creates image generation prompts</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
