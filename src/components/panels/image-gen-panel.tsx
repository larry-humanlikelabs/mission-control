'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMissionControl } from '@/store'

interface Generation {
  id: number
  prompt: string
  model: string
  resolution: string
  status: 'pending' | 'generating' | 'done' | 'failed'
  output_path?: string
  cost_usd: number
  created_at: number
}

interface GenerationStats {
  total: number
  total_cost: number
  this_month: number
}

export function ImageGenPanel() {
  const [prompt, setPrompt] = useState('')
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('1K')
  const [model, setModel] = useState('gemini-3.1-flash-image-preview')
  const [generations, setGenerations] = useState<Generation[]>([])
  const [stats, setStats] = useState<GenerationStats>({ total: 0, total_cost: 0, this_month: 0 })
  const [isGenerating, setIsGenerating] = useState(false)
  const [negativePrompt, setNegativePrompt] = useState('')

  useEffect(() => {
    fetchGenerations()
  }, [])

  const fetchGenerations = async () => {
    try {
      const res = await fetch('/api/images')
      if (res.ok) {
        const data = await res.json()
        setGenerations(data.generations || [])
        setStats(data.stats || { total: 0, total_cost: 0, this_month: 0 })
      }
    } catch (e) {
      console.error('Failed to fetch generations:', e)
    }
  }

  const generateImage = async () => {
    if (!prompt.trim()) return

    setIsGenerating(true)
    try {
      const res = await fetch('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, resolution, model, negativePrompt })
      })

      if (res.ok) {
        const data = await res.json()
        // Poll for result
        pollGeneration(data.id)
      }
    } catch (e) {
      console.error('Failed to generate:', e)
      setIsGenerating(false)
    }
  }

  const pollGeneration = async (id: number) => {
    const poll = async () => {
      const res = await fetch(`/api/images?id=${id}`)
      if (res.ok) {
        const data = await res.json()
        const gen = data.generation
        if (gen?.status === 'done' || gen?.status === 'failed') {
          setIsGenerating(false)
          fetchGenerations()
        } else {
          setTimeout(poll, 2000)
        }
      }
    }
    poll()
  }

  const resolutionOptions = [
    { value: '1K', label: '1K (1024×1024)', time: '~10s' },
    { value: '2K', label: '2K (2048×2048)', time: '~20s' },
    { value: '4K', label: '4K (4096×4096)', time: '~60s' },
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header with Stats */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="text-lg font-semibold">Image Generation</h2>
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{stats.total} total</span>
          <span>${stats.total_cost.toFixed(2)} spent</span>
          <span>{stats.this_month} this month</span>
        </div>
      </div>

      {/* Generate Form */}
      <div className="p-4 border-b space-y-3">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe the image you want to generate..."
          className="w-full h-24 px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">Resolution</label>
            <div className="flex gap-2">
              {resolutionOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setResolution(opt.value as '1K' | '2K' | '4K')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    resolution === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                >
                  {opt.label} ({opt.time})
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Input
            value={negativePrompt}
            onChange={e => setNegativePrompt(e.target.value)}
            placeholder="What to avoid (optional)"
            className="flex-1"
          />
          <Button
            onClick={generateImage}
            disabled={!prompt.trim() || isGenerating}
          >
            {isGenerating ? 'Generating...' : 'Generate'}
          </Button>
        </div>

        {/* Model selector */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Model:</span>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="bg-muted px-2 py-1 rounded"
          >
            <option value="gemini-3.1-flash-image-preview">Gemini 3.1 Flash</option>
            <option value="nano-banana-pro">Nano Banana Pro</option>
            <option value="dalle-3">DALL-E 3</option>
          </select>
        </div>
      </div>

      {/* Grid of generations */}
      <div className="flex-1 overflow-auto p-4">
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Recent Generations</h3>
        {generations.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg font-medium">No generations yet</p>
            <p className="text-sm mt-1">Create your first image above</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {generations.map(gen => (
              <GenerationCard key={gen.id} generation={gen} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function GenerationCard({ generation }: { generation: Generation }) {
  const statusColors = {
    pending: 'bg-yellow-500',
    generating: 'bg-blue-500 animate-pulse',
    done: 'bg-green-500',
    failed: 'bg-red-500'
  }

  return (
    <div className="bg-card rounded-xl border overflow-hidden">
      {/* Image placeholder or actual */}
      <div className="aspect-square bg-muted flex items-center justify-center relative">
        {generation.status === 'done' && generation.output_path ? (
          <img src={generation.output_path} alt={generation.prompt} className="w-full h-full object-cover" />
        ) : (
          <div className="text-muted-foreground">
            {generation.status === 'pending' && '⏳'}
            {generation.status === 'generating' && '🎨'}
            {generation.status === 'failed' && '❌'}
          </div>
        )}

        {/* Status dot */}
        <div className={`absolute top-2 right-2 w-3 h-3 rounded-full ${statusColors[generation.status]}`} />
      </div>

      {/* Info */}
      <div className="p-2 text-xs">
        <p className="font-medium truncate">{generation.prompt}</p>
        <div className="flex items-center justify-between mt-1 text-muted-foreground">
          <span>{generation.resolution}</span>
          <span>${generation.cost_usd.toFixed(4)}</span>
        </div>
      </div>
    </div>
  )
}
