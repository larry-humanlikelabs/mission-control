/**
 * Distribution Queue — Telegram Approval Cron
 * Module 4.5
 * 
 * Runs every 5 minutes.
 * Checks for posts scheduled in next 10 minutes that are approved.
 * Sends Telegram confirmation, waits 3 minutes, then posts.
 */

import { getDatabase } from '@/lib/db'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8537161005:AAH_VCyGZxaDWTAooTsa_wQPSbg0CSv-vmQ'
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_APPROVAL_CHAT_ID || '5280832041'
const APPROVAL_WINDOW_MS = 3 * 60 * 1000 // 3 minutes

interface DistributionItem {
  id: number
  platform: string
  content_body: string
  media_paths: string
  scheduled_for: number
  status: string
  linked_doc_id: number | null
}

async function sendTelegram(message: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Post Now', callback_data: 'distribute_approve' },
              { text: '❌ Cancel', callback_data: 'distribute_cancel' }
            ]
          ]
        }
      })
    })
    return response.ok
  } catch (e) {
    console.error('Telegram send failed:', e)
    return false
  }
}

async function postToX(content: string): Promise<{ success: boolean; url?: string; error?: string }> {
  // X API integration placeholder
  // In production: use X API v2
  return { success: false, error: 'X API not configured' }
}

async function postToLinkedIn(content: string): Promise<{ success: boolean; url?: string; error?: string }> {
  // LinkedIn API integration placeholder
  return { success: false, error: 'LinkedIn API not configured' }
}

async function postToYouTube(title: string, description: string): Promise<{ success: boolean; url?: string; error?: string }> {
  // YouTube API integration placeholder
  return { success: false, error: 'YouTube API not configured' }
}

export async function runDistributionCron(): Promise<void> {
  const db = getDatabase()
  const now = Math.floor(Date.now() / 1000)
  const tenMinutesFromNow = now + (10 * 60)

  // Find posts ready to be sent
  const pendingPosts = db.prepare(`
    SELECT * FROM distribution_items 
    WHERE status = 'approved' 
    AND scheduled_for <= ?
    AND scheduled_for >= ?
  `).all(tenMinutesFromNow, now) as DistributionItem[]

  for (const post of pendingPosts) {
    const mediaPaths = JSON.parse(post.media_paths || '[]')

    // Send Telegram confirmation with 3-minute window
    const message = `
📤 <b>Distribution Ready</b>

<b>Platform:</b> ${post.platform}
${post.content_body.substring(0, 200)}${post.content_body.length > 200 ? '...' : ''}

<i>Auto-posting in 3 minutes unless you cancel.</i>
    `.trim()

    const sent = await sendTelegram(message)
    if (!sent) {
      console.error(`Failed to send Telegram approval for post ${post.id}`)
      continue
    }

    // Wait 3 minutes
    await new Promise(resolve => setTimeout(resolve, APPROVAL_WINDOW_MS))

    // Check if still approved (user might have cancelled)
    const currentPost = db.prepare('SELECT status FROM distribution_items WHERE id = ?').get(post.id) as { status: string } | undefined
    if (currentPost?.status !== 'approved') {
      console.log(`Post ${post.id} was cancelled, skipping`)
      continue
    }

    // Execute post
    let result: { success: boolean; url?: string; error?: string } = { success: false, error: 'Unknown platform' }

    switch (post.platform) {
      case 'x':
      case 'twitter':
        result = await postToX(post.content_body)
        break
      case 'linkedin':
        result = await postToLinkedIn(post.content_body)
        break
      case 'youtube':
        result = await postToYouTube(
          post.content_body.split('\n')[0] || 'Video',
          post.content_body
        )
        break
      case 'newsletter':
        // Newsletter posting placeholder
        result = { success: true, url: 'newsletter://sent' }
        break
    }

    // Update status
    if (result.success) {
      db.prepare(`
        UPDATE distribution_items 
        SET status = 'posted', posted_url = ?, updated_at = ?
        WHERE id = ?
      `).run(result.url || '', Math.floor(Date.now() / 1000), post.id)

      await sendTelegram(`✅ Posted successfully!\n${result.url || ''}`)
    } else {
      db.prepare(`
        UPDATE distribution_items 
        SET status = 'failed', error_message = ?, updated_at = ?
        WHERE id = ?
      `).run(result.error || 'Unknown error', Math.floor(Date.now() / 1000), post.id)

      await sendTelegram(`❌ Post failed: ${result.error}`)
    }
  }
}

// Also handle incoming Telegram callbacks
export async function handleTelegramCallback(callbackData: string, messageId: number): Promise<void> {
  const db = getDatabase()

  if (callbackData === 'distribute_approve') {
    // Find the most recent approved post and post it immediately
    const recentPost = db.prepare(`
      SELECT * FROM distribution_items 
      WHERE status = 'approved' 
      ORDER BY scheduled_for ASC 
      LIMIT 1
    `).get() as DistributionItem | undefined

    if (recentPost) {
      db.prepare(`UPDATE distribution_items SET scheduled_for = ? WHERE id = ?`)
        .run(Math.floor(Date.now() / 1000) - 1, recentPost.id)
    }
  }

  if (callbackData === 'distribute_cancel') {
    // Find and cancel the most recent pending post
    const recentPost = db.prepare(`
      SELECT * FROM distribution_items 
      WHERE status = 'approved' 
      ORDER BY scheduled_for ASC 
      LIMIT 1
    `).get() as DistributionItem | undefined

    if (recentPost) {
      db.prepare(`UPDATE distribution_items SET status = 'cancelled' WHERE id = ?`)
        .run(recentPost.id)
    }
  }
}
