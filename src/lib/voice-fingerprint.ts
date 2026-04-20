/**
 * Voice Fingerprint — Content Generation Suite Module 4.3
 * 
 * Extracts voice characteristics from Mr. Parker's existing content.
 * Used to score and correct generated content against his voice.
 */

import * as fs from 'fs'
import * as path from 'path'

interface VoiceFingerprint {
  avgSentenceLength: number
  vocabularyMarkers: string[]      // Words he uses frequently
  rhetoricalMoves: string[]       // His patterns: "Here's the thing", "At the end of the day", etc.
  neverSays: string[]            // Things he NEVER says (AI tells to strip)
  emDashFrequency: number        // Ratio of em-dashes per 1000 words
  commaDensity: number            // Commas per sentence
  paragraphLength: number         // Avg sentences per paragraph
  capitalizationPatterns: string[] // How he uses caps
  contractionUsage: number          // Ratio of contractions
  emojiUsage: number              // Emoji per 1000 words
  questionFrequency: number        // Questions per 1000 words
  createdAt: number
  sourceFiles: string[]
}

const NEVER_SAYS_DEFAULT = [
  "at the end of the day",
  "leveraging",
  "synergy",
  "circle back",
  "deep dive",
  "game changer",
  "best practice",
  "low-hanging fruit",
  "move the needle",
  "paradigm shift",
  "think outside the box",
  "touch base",
]

export function extractVoiceFingerprint(contentSamples: string[]): VoiceFingerprint {
  const allText = contentSamples.join(' ')
  const sentences = allText.split(/[.!?]+/).filter(s => s.trim().length > 0)
  const words = allText.split(/\s+/).filter(w => w.length > 0)
  
  // Calculate metrics
  const avgSentenceLength = words.length / sentences.length
  const emDashCount = (allText.match(/—/g) || []).length
  const emDashFrequency = (emDashCount / words.length) * 1000
  const commaCount = (allText.match(/,/g) || []).length
  const commaDensity = commaCount / sentences.length
  
  // Paragraphs
  const paragraphs = allText.split(/\n\n+/).filter(p => p.trim().length > 0)
  const paragraphLength = sentences.length / paragraphs.length
  
  // Contractions
  const contractions = (allText.match(/\w+'\w+/g) || []).length
  const contractionUsage = contractions / words.length
  
  // Emoji
  const emoji = (allText.match(/[\u{1F300}-\u{1F9FF}]/gu) || []).length
  const emojiUsage = (emoji / words.length) * 1000
  
  // Questions
  const questions = (allText.match(/\?/g) || []).length
  const questionFrequency = (questions / words.length) * 1000

  // Vocabulary markers (most frequent meaningful words)
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither', 'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'any', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her', 'it', 'its', 'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'whose'])
  
  const wordFreq: Record<string, number> = {}
  for (const word of words) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '')
    if (w.length > 3 && !stopWords.has(w)) {
      wordFreq[w] = (wordFreq[w] || 0) + 1
    }
  }
  
  const vocabularyMarkers = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([word]) => word)

  const fingerprint: VoiceFingerprint = {
    avgSentenceLength: Math.round(avgSentenceLength * 10) / 10,
    vocabularyMarkers,
    rhetoricalMoves: detectRhetoricalMoves(allText),
    neverSays: NEVER_SAYS_DEFAULT,
    emDashFrequency: Math.round(emDashFrequency * 100) / 100,
    commaDensity: Math.round(commaDensity * 100) / 100,
    paragraphLength: Math.round(paragraphLength * 10) / 10,
    capitalizationPatterns: detectCapitalizationPatterns(allText),
    contractionUsage: Math.round(contractionUsage * 1000) / 1000,
    emojiUsage: Math.round(emojiUsage * 100) / 100,
    questionFrequency: Math.round(questionFrequency * 100) / 100,
    createdAt: Date.now(),
    sourceFiles: []
  }

  return fingerprint
}

function detectRhetoricalMoves(text: string): string[] {
  const moves: string[] = []
  const lower = text.toLowerCase()
  
  const patterns = [
    { pattern: /here's the thing/gi, move: "here's the thing" },
    { pattern: /the bottom line/gi, move: "the bottom line" },
    { pattern: /at the end of the day/gi, move: "at the end of the day" },
    { pattern: /let me be clear/gi, move: "let me be clear" },
    { pattern: /the fact is/gi, move: "the fact is" },
    { pattern: /here's what/gi, move: "here's what" },
    { pattern: /the reality/gi, move: "the reality" },
    { pattern: /the truth/gi, move: "the truth" },
    { pattern: /what nobody tells you/gi, move: "what nobody tells you" },
    { pattern: /the problem is/gi, move: "the problem is" },
  ]
  
  for (const { pattern, move } of patterns) {
    if (pattern.test(lower)) {
      moves.push(move)
    }
  }
  
  return moves
}

function detectCapitalizationPatterns(text: string): string[] {
  const patterns: string[] = []
  
  // Check for Title Case usage
  const titleCaseCount = (text.match(/[A-Z][a-z]+ [A-Z][a-z]+/g) || []).length
  if (titleCaseCount > 5) patterns.push('title_case_frequent')
  
  // Check for ALL CAPS words (excluding acronyms)
  const capsWords = (text.match(/\b[A-Z]{2,}\b/g) || []).length
  const allWords = text.split(/\s+/).length
  if (capsWords / allWords > 0.02) patterns.push('caps_rare')
  
  return patterns
}

export function scoreContent(content: string, fingerprint: VoiceFingerprint): {
  score: number
  issues: string[]
  improvements: string[]
} {
  const issues: string[] = []
  const improvements: string[] = []
  const lower = content.toLowerCase()
  
  // Check NEVER SAYS
  for (const neverSay of fingerprint.neverSays) {
    if (lower.includes(neverSay)) {
      issues.push(`Contains phrase he never says: "${neverSay}"`)
      improvements.push(`Remove "${neverSay}" — not in his voice`)
    }
  }
  
  // Sentence length check
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0)
  const words = content.split(/\s+/).filter(w => w.length > 0)
  const avgLen = words.length / sentences.length
  if (Math.abs(avgLen - fingerprint.avgSentenceLength) > 8) {
    issues.push(`Sentence length (${Math.round(avgLen)}) differs from his style (${Math.round(fingerprint.avgSentenceLength)})`)
  }
  
  // Em-dash check — he uses them
  const hasEmDashes = content.includes('—')
  if (!hasEmDashes && content.length > 200) {
    improvements.push('Add em-dashes for his characteristic pacing')
  }
  
  // Vocabulary check
  const contentWords = content.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-z]/g, ''))
  const hisVocabulary = new Set(fingerprint.vocabularyMarkers.slice(0, 20))
  const matchingVocab = contentWords.filter(w => hisVocabulary.has(w)).length
  const vocabRatio = matchingVocab / contentWords.length
  if (vocabRatio < 0.1) {
    improvements.push('Use more of his characteristic vocabulary')
  }
  
  // Calculate score
  let score = 100 - (issues.length * 15) + (improvements.length * -5)
  score = Math.max(0, Math.min(100, score))
  
  return { score, issues, improvements }
}

export function applyVoiceCorrections(content: string, fingerprint: VoiceFingerprint): string {
  let corrected = content
  
  // Remove never-says
  for (const neverSay of fingerprint.neverSays) {
    const regex = new RegExp(neverSay, 'gi')
    corrected = corrected.replace(regex, '[REMOVE]')
  }
  
  // Strip AI tells
  const aiTells = [
    /\bIt'\s*important to note\b/gi,
    /\bAdditionally\b/gi,
    /\bIn conclusion\b/gi,
    /\bTo summarize\b/gi,
    /\bFurthermore\b/gi,
    /\bMoreover\b/gi,
    /\bNevertheless\b/gi,
    /\bNonetheless\b/gi,
    /\bHence\b/gi,
    /\bThus\b/gi,
    /\bWhereby\b/gi,
    /\bHerein\b/gi,
    /\bTherein\b/gi,
  ]
  
  for (const tell of aiTells) {
    corrected = corrected.replace(tell, '')
  }
  
  // Clean up double spaces
  corrected = corrected.replace(/\s+/g, ' ')
  
  return corrected.trim()
}

export function saveFingerprint(fingerprint: VoiceFingerprint): void {
  const fingerprintPath = '/Users/maximus/.openclaw/voice-fingerprint.json'
  fs.writeFileSync(fingerprintPath, JSON.stringify(fingerprint, null, 2))
}

export function loadFingerprint(): VoiceFingerprint | null {
  const fingerprintPath = '/Users/maximus/.openclaw/voice-fingerprint.json'
  if (!fs.existsSync(fingerprintPath)) return null
  try {
    return JSON.parse(fs.readFileSync(fingerprintPath, 'utf-8'))
  } catch {
    return null
  }
}

export function fitFingerprint(contentSamples: string[]): VoiceFingerprint {
  const fingerprint = extractVoiceFingerprint(contentSamples)
  saveFingerprint(fingerprint)
  return fingerprint
}
