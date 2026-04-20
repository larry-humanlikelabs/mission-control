'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface DistributionItem {
  id: number
  platform: string
  content_body: string
  scheduled_for: number
  status: string
  posted_url?: string
}

export function DistributionPanel() {
  const [items, setItems] = useState<DistributionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newItem, setNewItem] = useState({
    platform: 'x',
    content: '',
    scheduleDate: '',
    scheduleTime: ''
  })

  useEffect(() => { fetchItems() }, [])

  const fetchItems = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/distribution')
      if (res.ok) setItems((await res.json()).items || [])
    } catch (e) { console.error('Failed to fetch:', e) }
    setLoading(false)
  }

  const schedulePost = async () => {
    if (!newItem.content.trim()) return
    const scheduledFor = new Date(`${newItem.scheduleDate}T${newItem.scheduleTime}`).getTime() / 1000
    try {
      await fetch('/api/distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'schedule',
          platform: newItem.platform,
          content_body: newItem.content,
          scheduled_for: scheduledFor
        })
      })
      setShowCreate(false)
      setNewItem({ platform: 'x', content: '', scheduleDate: '', scheduleTime: '' })
      fetchItems()
    } catch (e) { console.error('Failed to schedule:', e) }
  }

  const cancelPost = async (id: number) => {
    try {
      await fetch('/api/distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', id })
      })
      fetchItems()
    } catch (e) { console.error('Failed to cancel:', e) }
  }

  const approvePost = async (id: number) => {
    try {
      await fetch('/api/distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', id })
      })
      fetchItems()
    } catch (e) { console.error('Failed to approve:', e) }
  }

  const platformIcons: Record<string, string> = {
    x: '𝕏',
    linkedin: '💼',
    youtube: '📺',
    instagram: '📷',
    threads: '🧵',
    newsletter: '📧'
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-400',
    queued: 'bg-yellow-500',
    approved: 'bg-blue-500',
    posted: 'bg-green-500',
    failed: 'bg-red-500',
    cancelled: 'bg-gray-600'
  }

  const now = Math.floor(Date.now() / 1000)
  const upcoming = items.filter(i => i.scheduled_for > now)
  const past = items.filter(i => i.scheduled_for <= now)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <h2 className="text-lg font-semibold">Distribution Queue</h2>
        <Button onClick={() => setShowCreate(true)} size="sm">+ Schedule Post</Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : (
          <>
            {/* Upcoming */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-3">Scheduled ({upcoming.length})</h3>
              {upcoming.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No scheduled posts</p>
                  <p className="text-xs mt-1">Click "+ Schedule Post" to queue content</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcoming.map(item => (
                    <DistributionCard
                      key={item.id}
                      item={item}
                      onApprove={approvePost}
                      onCancel={cancelPost}
                      platformIcons={platformIcons}
                      statusColors={statusColors}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Past */}
            {past.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">History</h3>
                <div className="space-y-3 opacity-60">
                  {past.slice(0, 10).map(item => (
                    <DistributionCard
                      key={item.id}
                      item={item}
                      onApprove={approvePost}
                      onCancel={cancelPost}
                      platformIcons={platformIcons}
                      statusColors={statusColors}
                      isPast
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card rounded-xl shadow-2xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-semibold">Schedule Post</h3>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-sm font-medium">Platform</label>
                <div className="flex gap-2 mt-1">
                  {Object.entries(platformIcons).map(([platform, icon]) => (
                    <button
                      key={platform}
                      onClick={() => setNewItem({ ...newItem, platform })}
                      className={`px-3 py-2 rounded-lg border text-sm ${
                        newItem.platform === platform ? 'border-primary bg-primary/10' : ''
                      }`}
                    >
                      {icon} {platform}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Content</label>
                <textarea
                  value={newItem.content}
                  onChange={e => setNewItem({ ...newItem, content: e.target.value })}
                  placeholder="What do you want to post?"
                  className="mt-1 w-full h-32 px-3 py-2 rounded-lg border border-input bg-background text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Date</label>
                  <Input
                    type="date"
                    value={newItem.scheduleDate}
                    onChange={e => setNewItem({ ...newItem, scheduleDate: e.target.value })}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Time</label>
                  <Input
                    type="time"
                    value={newItem.scheduleTime}
                    onChange={e => setNewItem({ ...newItem, scheduleTime: e.target.value })}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={schedulePost} disabled={!newItem.content.trim() || !newItem.scheduleDate}>
                  Schedule
                </Button>
                <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function DistributionCard({
  item,
  onApprove,
  onCancel,
  platformIcons,
  statusColors,
  isPast
}: {
  item: DistributionItem
  onApprove: (id: number) => void
  onCancel: (id: number) => void
  platformIcons: Record<string, string>
  statusColors: Record<string, string>
  isPast?: boolean
}) {
  const scheduleDate = new Date(item.scheduled_for * 1000)

  return (
    <div className="bg-card rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <span className="text-xl">{platformIcons[item.platform]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium capitalize">{item.platform}</p>
            <span className={`w-2 h-2 rounded-full ${statusColors[item.status]}`} />
            <span className="text-xs text-muted-foreground">
              {scheduleDate.toLocaleDateString()} at {scheduleDate.toLocaleTimeString()}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{item.content_body}</p>
          {item.posted_url && (
            <a href={item.posted_url} target="_blank" className="text-xs text-primary mt-1 inline-block">
              View posted →
            </a>
          )}
        </div>
        {!isPast && (
          <div className="flex gap-2">
            {item.status === 'queued' && (
              <Button onClick={() => onApprove(item.id)} size="sm" variant="outline">
                Approve
              </Button>
            )}
            {item.status !== 'posted' && (
              <Button onClick={() => onCancel(item.id)} size="sm" variant="ghost" className="text-red-500">
                Cancel
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
