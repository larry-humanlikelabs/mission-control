/**
 * YouTube Scraper — Content Spy Module 4.1
 * 
 * Scrapes YouTube channels for competitor intel.
 * Uses YouTube Data API v3.
 */

interface YouTubeConfig {
  apiKey: string
}

interface ChannelStats {
  channelId: string
  title: string
  subscriberCount: number
  videoCount: number
  viewCount: number
}

interface Video {
  id: string
  title: string
  description: string
  publishedAt: string
  channelId: string
  channelTitle: string
  viewCount: number
  likeCount: number
  commentCount: number
  duration: string
  tags: string[]
}

interface ScrapeResult {
  channel: ChannelStats
  videos: Video[]
  transcripts: Record<string, string>
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

async function youtubeApiGet(endpoint: string, params: Record<string, string>, apiKey: string): Promise<any> {
  const url = new URL(`${YOUTUBE_API_BASE}/${endpoint}`)
  url.searchParams.set('key', apiKey)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  
  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`YouTube API error: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

export async function getChannelStats(channelId: string, apiKey: string): Promise<ChannelStats> {
  const data = await youtubeApiGet('channels', {
    part: 'snippet,statistics,contentDetails',
    id: channelId
  }, apiKey)

  if (!data.items || data.items.length === 0) {
    throw new Error(`Channel not found: ${channelId}`)
  }

  const channel = data.items[0]
  return {
    channelId,
    title: channel.snippet.title,
    subscriberCount: parseInt(channel.statistics.subscriberCount || '0'),
    videoCount: parseInt(channel.statistics.videoCount || '0'),
    viewCount: parseInt(channel.statistics.viewCount || '0')
  }
}

export async function getRecentVideos(channelId: string, maxResults: number = 20, apiKey: string): Promise<Video[]> {
  // Get uploads playlist
  const channelData = await youtubeApiGet('channels', {
    part: 'contentDetails',
    id: channelId
  }, apiKey)

  if (!channelData.items || channelData.items.length === 0) {
    return []
  }

  const uploadsPlaylistId = channelData.items[0].contentDetails.relatedPlaylists.uploads

  // Get playlist items (videos)
  const playlistData = await youtubeApiGet('playlistItems', {
    part: 'snippet,contentDetails',
    playlistId: uploadsPlaylistId,
    maxResults: String(maxResults)
  }, apiKey)

  const videoIds = playlistData.items.map((item: any) => item.contentDetails.videoId)

  if (videoIds.length === 0) return []

  // Get video details
  const videosData = await youtubeApiGet('videos', {
    part: 'snippet,statistics,contentDetails',
    id: videoIds.join(',')
  }, apiKey)

  return videosData.items.map((video: any) => ({
    id: video.id,
    title: video.snippet.title,
    description: video.snippet.description,
    publishedAt: video.snippet.publishedAt,
    channelId: video.snippet.channelId,
    channelTitle: video.snippet.channelTitle,
    viewCount: parseInt(video.statistics.viewCount || '0'),
    likeCount: parseInt(video.statistics.likeCount || '0'),
    commentCount: parseInt(video.statistics.commentCount || '0'),
    duration: video.contentDetails.duration || '',
    tags: video.snippet.tags || []
  }))
}

export async function searchVideos(query: string, maxResults: number = 20, apiKey: string): Promise<Video[]> {
  const searchData = await youtubeApiGet('search', {
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'relevance',
    maxResults: String(maxResults)
  }, apiKey)

  const videoIds = searchData.items.map((item: any) => item.id.videoId).filter(Boolean)

  if (videoIds.length === 0) return []

  // Get video details
  const videosData = await youtubeApiGet('videos', {
    part: 'snippet,statistics,contentDetails',
    id: videoIds.join(',')
  }, apiKey)

  return videosData.items.map((video: any) => ({
    id: video.id,
    title: video.snippet.title,
    description: video.snippet.description,
    publishedAt: video.snippet.publishedAt,
    channelId: video.snippet.channelId,
    channelTitle: video.snippet.channelTitle,
    viewCount: parseInt(video.statistics.viewCount || '0'),
    likeCount: parseInt(video.statistics.likeCount || '0'),
    commentCount: parseInt(video.statistics.commentCount || '0'),
    duration: video.contentDetails.duration || '',
    tags: video.snippet.tags || []
  }))
}

export function extractEngagement(video: Video): {
  engagementRate: number
  tier: 'viral' | 'high' | 'medium' | 'low'
  score: number
} {
  const totalEngagement = video.likeCount + video.commentCount * 5 // Comments weighted higher
  const engagementRate = video.viewCount > 0 ? (totalEngagement / video.viewCount) * 100 : 0

  let tier: 'viral' | 'high' | 'medium' | 'low'
  if (engagementRate > 10) tier = 'viral'
  else if (engagementRate > 5) tier = 'high'
  else if (engagementRate > 1) tier = 'medium'
  else tier = 'low'

  const score = Math.min(100, engagementRate * 10)

  return { engagementRate: Math.round(engagementRate * 100) / 100, tier, score: Math.round(score) }
}

export function extractHook(video: Video): {
  hook: string
  angle: string
  format: string
  claim: string
} {
  // Extract hook from title
  const title = video.title
  let hook = title

  // Detect hook type
  if (title.match(/^why/i)) hook = 'question_opener'
  else if (title.match(/^how/i)) hook = 'how_to'
  else if (title.match(/^what/i)) hook = 'what_insight'
  else if (title.match(/^this is why/i)) hook = 'revelation'
  else if (title.match(/^the truth about/i)) hook = 'myth_bust'
  else if (title.match(/^i tried/i)) hook = 'personal_experiment'
  else if (title.match(/^here's?/i)) hook = 'direct_answer'
  else hook = 'curiosity_gap'

  // Extract angle
  let angle = 'educational'
  if (title.match(/review|test|experiment/i)) angle = 'proof'
  else if (title.match(/secret|truth|reality/i)) angle = 'myth_bust'
  else if (title.match(/make money|earn|income/i)) angle = 'financial'
  else if (title.match(/build|create|start/i)) angle = 'actionable'

  // Extract format
  let format = 'long_form'
  if (video.duration && parseDuration(video.duration) < 300) format = 'short'
  else if (video.duration && parseDuration(video.duration) < 600) format = 'medium'

  // Extract claim
  const claim = extractMainClaim(video.description)

  return { hook, angle, format, claim }
}

function parseDuration(duration: string): number {
  // PT1H2M3S format
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const hours = parseInt(match[1] || '0')
  const minutes = parseInt(match[2] || '0')
  const seconds = parseInt(match[3] || '0')
  return hours * 3600 + minutes * 60 + seconds
}

function extractMainClaim(description: string): string {
  // Look for the first strong statement
  const lines = description.split('\n').filter(l => l.trim().length > 0)
  
  for (const line of lines) {
    const trimmed = line.trim()
    // Skip very short or very long lines
    if (trimmed.length < 20 || trimmed.length > 200) continue
    
    // Look for claim indicators
    if (trimmed.match(/\d+%|\$\d+|increas|improv|made \$\d+|grew|broke/)) {
      return trimmed.substring(0, 150)
    }
  }
  
  // Fall back to first substantial line
  for (const line of lines) {
    if (line.trim().length > 50) {
      return line.trim().substring(0, 150)
    }
  }
  
  return ''
}

export interface SpyTarget {
  id: number
  name: string
  platform: string
  channelId?: string
  username?: string
  keywords?: string[]
}

export async function scrapeTarget(target: SpyTarget, apiKey: string): Promise<ScrapeResult | null> {
  if (target.platform !== 'youtube' || !target.channelId) {
    return null
  }

  try {
    const [channel, videos] = await Promise.all([
      getChannelStats(target.channelId, apiKey),
      getRecentVideos(target.channelId, 10, apiKey)
    ])

    // Extract engagement and hooks for each video
    const enrichedVideos = videos.map(video => {
      const engagement = extractEngagement(video)
      const extracted = extractHook(video)
      return {
        ...video,
        engagement,
        hook: extracted.hook,
        angle: extracted.angle,
        format: extracted.format,
        claim: extracted.claim
      }
    })

    return {
      channel,
      videos: enrichedVideos,
      transcripts: {} // Would need yt-dlp for transcripts
    }
  } catch (e) {
    console.error(`Failed to scrape YouTube channel ${target.channelId}:`, e)
    return null
  }
}
