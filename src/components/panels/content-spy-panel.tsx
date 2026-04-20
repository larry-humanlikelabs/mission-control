'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SpyTarget {
  id: number
  name: string
  platform: string
  username?: string
  status: string
}

interface SpyPost {
  id: number
  target_name: string
  platform: string
  author: string
  text_content: string
  engagement: { views?: number; likes?: number; shares?: number }
  captured_at: number
}

interface SpyDigest {
  date: string
  post_count: number
  top_posts: SpyPost[]
}

export function ContentSpyPanel() {
  const [activeTab, setActiveTab] = useState<'feed' | 'targets' | 'digest'>('feed')
  const [targets, setTargets] = useState<SpyTarget[]>([])
  const [posts, setPosts] = useState<SpyPost[]>([])
  const [digest, setDigest] = useState<SpyDigest | null>(null)
  const [newTarget, setNewTarget] = useState({ name: '', platform: 'youtube', username: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchData()
  }, [activeTab])

  const fetchData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'targets') {
        const res = await fetch('/api/spy?action=targets')
        if (res.ok) setTargets((await res.json()).targets || [])
      } else if (activeTab === 'feed') {
        const res = await fetch('/api/spy?action=posts&limit=50')
        if (res.ok) setPosts((await res.json()).posts || [])
      } else if (activeTab === 'digest') {
        const res = await fetch('/api/spy?action=digest')
        if (res.ok) setDigest((await res.json()).digest || null)
      }
    } catch (e) {
      console.error('Failed to fetch spy data:', e)
    }
    setLoading(false)
  }

  const addTarget = async () => {
    if (!newTarget.name.trim()) return
    try {
      await fetch('/api/spy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addTarget', ...newTarget })
      })
      setNewTarget({ name: '', platform: 'youtube', username: '' })
      fetchData()
    } catch (e) {
      console.error('Failed to add target:', e)
    }
  }

  const runScrape = async () => {
    try {
      await fetch('/api/spy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'runScrape' })
      })
      // Refresh after scrape
      setTimeout(fetchData, 2000)
    } catch (e) {
      console.error('Failed to run scrape:', e)
    }
  }

  const platformIcons: Record<string, string> = {
    youtube: '📺',
    x: '𝕏',
    tiktok: '🎵',
    linkedin: '💼',
    reddit: '🤖'
  }

  const platformColors: Record<string, string> = {
    youtube: 'text-red-500',
    x: 'text-white',
    tiktok: 'text-pink-500',
    linkedin: 'text-blue-600',
    reddit: 'text-orange-500'
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="text-lg font-semibold">Content Spy</h2>
        <Button onClick={runScrape} size="sm" variant="outline">
          🔄 Run Scrape
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {(['feed', 'targets', 'digest'] as const).map(tab => (
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
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {activeTab === 'feed' && <FeedTab posts={posts} platformIcons={platformIcons} />}
            {activeTab === 'targets' && (
              <TargetsTab
                targets={targets}
                newTarget={newTarget}
                setNewTarget={setNewTarget}
                addTarget={addTarget}
                platformIcons={platformIcons}
              />
            )}
            {activeTab === 'digest' && <DigestTab digest={digest} platformIcons={platformIcons} />}
          </>
        )}
      </div>
    </div>
  )
}

function FeedTab({ posts, platformIcons }: { posts: SpyPost[]; platformIcons: Record<string, string> }) {
  if (posts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">No posts tracked yet</p>
        <p className="text-sm mt-1">Add targets in the Targets tab to start tracking</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {posts.map(post => (
        <div key={post.id} className="bg-card rounded-xl border p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{platformIcons[post.platform] || '📱'}</span>
            <span className="font-medium">{post.target_name}</span>
            <span className="text-sm text-muted-foreground">@{post.author}</span>
            <span className="text-xs text-muted-foreground ml-auto">
              {new Date(post.captured_at * 1000).toLocaleDateString()}
            </span>
          </div>
          <p className="text-sm">{post.text_content}</p>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span>👁 {post.engagement.views?.toLocaleString() || 0}</span>
            <span>❤️ {post.engagement.likes?.toLocaleString() || 0}</span>
            <span>🔄 {post.engagement.shares?.toLocaleString() || 0}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function TargetsTab({
  targets,
  newTarget,
  setNewTarget,
  addTarget,
  platformIcons
}: {
  targets: SpyTarget[]
  newTarget: { name: string; platform: string; username: string }
  setNewTarget: (t: any) => void
  addTarget: () => void
  platformIcons: Record<string, string>
}) {
  return (
    <div className="space-y-4">
      {/* Add new target */}
      <div className="bg-card rounded-xl border p-4 space-y-3">
        <h3 className="font-medium">Add Competitor Target</h3>
        <div className="flex gap-2">
          <select
            value={newTarget.platform}
            onChange={e => setNewTarget({ ...newTarget, platform: e.target.value })}
            className="px-3 py-2 rounded-lg border bg-background text-sm"
          >
            <option value="youtube">YouTube</option>
            <option value="x">X / Twitter</option>
            <option value="tiktok">TikTok</option>
            <option value="linkedin">LinkedIn</option>
            <option value="reddit">Reddit</option>
          </select>
          <Input
            value={newTarget.name}
            onChange={e => setNewTarget({ ...newTarget, name: e.target.value })}
            placeholder="Channel/Account name"
            className="flex-1"
          />
          <Button onClick={addTarget} disabled={!newTarget.name.trim()}>
            Add
          </Button>
        </div>
      </div>

      {/* Target list */}
      <div className="grid grid-cols-2 gap-3">
        {targets.map(target => (
          <div key={target.id} className="bg-card rounded-xl border p-3">
            <div className="flex items-center gap-2">
              <span className="text-lg">{platformIcons[target.platform]}</span>
              <div>
                <p className="font-medium">{target.name}</p>
                {target.username && (
                  <p className="text-xs text-muted-foreground">@{target.username}</p>
                )}
              </div>
              <span className={`ml-auto w-2 h-2 rounded-full ${
                target.status === 'active' ? 'bg-green-500' : 'bg-gray-400'
              }`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DigestTab({ digest, platformIcons }: { digest: SpyDigest | null; platformIcons: Record<string, string> }) {
  if (!digest) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-lg font-medium">No digest yet</p>
        <p className="text-sm mt-1">Run a scrape to generate your first intel digest</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-primary/10 rounded-xl p-4">
        <h3 className="font-semibold">📊 Daily Intel — {digest.date}</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {digest.post_count} posts tracked from {new Set(digest.top_posts.map(p => p.target_name)).size} sources
        </p>
      </div>

      <h3 className="font-medium">Top Posts</h3>
      {digest.top_posts.map((post, i) => (
        <div key={i} className="bg-card rounded-xl border p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{platformIcons[post.platform]}</span>
            <span className="font-medium">{post.target_name}</span>
          </div>
          <p className="text-sm">{post.text_content}</p>
        </div>
      ))}
    </div>
  )
}
