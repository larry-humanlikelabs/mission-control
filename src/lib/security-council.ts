/**
 * security-council.ts — Nightly Security Council audit
 *
 * Four lenses: Offensive, Defensive, Privacy, Operational Realism
 * Data scope: gateway config, activity log (last 24h), .env structure,
 * git log, recent skill installs.
 *
 * CRITICAL FINDINGS (CVSS >= 7): immediate Telegram alert.
 * All findings: stored in security_audit_log, returned via GET /api/security
 */

import { getDatabase } from './db'
import { logger } from './logger'
import { config } from './config'
import { join, basename } from 'path'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { execSync } from 'child_process'

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8537161005:AAH_VCyGZxaDWTAooTsa_wQPSbg0CSv-vmQ'
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_ALERT_CHAT_ID || '5280832041'

export interface Finding {
  number: number
  lens: 'offensive' | 'defensive' | 'privacy' | 'operational'
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  cvss?: number
  title: string
  description: string
  recommendation: string
  source_file?: string
  new_vs_recurring: 'new' | 'recurring'
}

export interface AuditRun {
  run_at: number
  findings: Finding[]
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  summary: string
}

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

function severityToCVSS(s: Finding['severity']): number {
  return s === 'critical' ? 9.5 : s === 'high' ? 7.5 : s === 'medium' ? 5.0 : s === 'low' ? 2.5 : 0
}

function cvssToSeverity(cvss: number): Finding['severity'] {
  if (cvss >= 9) return 'critical'
  if (cvss >= 7) return 'high'
  if (cvss >= 4) return 'medium'
  if (cvss >= 0.1) return 'low'
  return 'info'
}

// ---------------------------------------------------------------------------
// Lens 1: Offensive (exploitability)
// ---------------------------------------------------------------------------

function runOffensiveLens(): Finding[] {
  const findings: Finding[] = []
  let num = 1
  const openclawHome = config.openclawHome || process.env.OPENCLAW_HOME || join(process.env.HOME || '/root', '.openclaw')

  // Check for exposed secrets in workspace files
  const secretPatterns = [
    { pattern: /sk-[a-zA-Z0-9]{20,}/, name: 'OpenAI-style API key' },
    { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub PAT' },
    { pattern: /xox[baprs]-[a-zA-Z0-9]{10,}/, name: 'Slack token' },
    { pattern: /AIza[a-zA-Z0-9_-]{35}/, name: 'Google API key' },
    { pattern: /sq0[a-z]{3}-[a-zA-Z0-9_-]{22}/, name: 'Square OAuth secret' },
  ]

  const sensitiveExtensions = ['.env', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf']
  let fileCount = 0
  const maxFilesScan = 500

  try {
    const walkAndCheck = (dir: string, depth = 0): void => {
      if (depth > 4 || fileCount >= maxFilesScan) return
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (fileCount >= maxFilesScan) break
          if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '__pycache__') continue
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            walkAndCheck(full, depth + 1)
          } else if (entry.isFile()) {
            const ext = '.' + entry.name.split('.').pop()?.toLowerCase()
            if (!sensitiveExtensions.includes(ext)) return
            try {
              const content = readFileSync(full, 'utf-8')
              for (const { pattern, name } of secretPatterns) {
                if (pattern.test(content)) {
                  findings.push({
                    number: num++,
                    lens: 'offensive',
                    severity: 'critical',
                    cvss: 9.8,
                    title: `Exposed secret detected in ${basename(full)}`,
                    description: `A ${name} appears to be hardcoded in ${full}. This is a critical credential exposure risk.`,
                    recommendation: 'Remove the secret from the file immediately. Rotate the credential. Store secrets in environment variables or a vault.',
                    source_file: full,
                    new_vs_recurring: 'new',
                  })
                }
              }
              fileCount++
            } catch {}
          }
        }
      } catch {}
    }
    walkAndCheck(join(openclawHome, 'workspace'))
    walkAndCheck(join(openclawHome, 'agents'))
  } catch {}

  // Check for open permissions on shell/exec endpoints
  try {
    const gatewayConfigPath = join(openclawHome, 'gateway.json')
    if (existsSync(gatewayConfigPath)) {
      const cfg = JSON.parse(readFileSync(gatewayConfigPath, 'utf-8'))
      if (cfg?.permissions?.exec === 'allow-all' || cfg?.permissions?.shell === 'unrestricted') {
        findings.push({
          number: num++,
          lens: 'offensive',
          severity: 'high',
          cvss: 7.5,
          title: 'Gateway exec permissions are unrestrictive',
          description: `gateway.json has permissive exec/shell settings. This elevates the blast radius of any compromised session.`,
          recommendation: 'Restrict exec permissions to named agents or require approval mode. See openclaw hardening guide.',
          source_file: gatewayConfigPath,
          new_vs_recurring: 'new',
        })
      }
    }
  } catch {}

  // Check for git secrets in recent commits
  try {
    const repoRoot = join(openclawHome, 'workspace', '..')
    const output = execSync('git log --oneline -20 -- . 2>/dev/null || true', { cwd: repoRoot, timeout: 5000, encoding: 'utf-8' })
    if (output.includes('secret') || output.includes('password') || output.includes('token')) {
      findings.push({
        number: num++,
        lens: 'offensive',
        severity: 'medium',
        cvss: 5.1,
        title: 'Suspicious commit messages detected in recent history',
        description: 'Recent commit messages reference secrets or credentials. Review git history for accidental secret commits.',
        recommendation: 'Run `git log --all --full-history -- . | grep -i secret` to find affected commits. Use git-filter-repo to remove secrets.',
        new_vs_recurring: 'new',
      })
    }
  } catch {}

  return findings
}

// ---------------------------------------------------------------------------
// Lens 2: Defensive (protections adequate?)
// ---------------------------------------------------------------------------

function runDefensiveLens(): Finding[] {
  const findings: Finding[] = []
  let num = 100 // offset to keep numbers unique across lenses
  const openclawHome = config.openclawHome || process.env.OPENCLAW_HOME || join(process.env.HOME || '/root', '.openclaw')

  // Check if rate limiting is configured
  try {
    const settingsPath = join(openclawHome, 'settings.json')
    if (existsSync(settingsPath)) {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      if (!settings?.rateLimit?.enabled) {
        findings.push({
          number: num++,
          lens: 'defensive',
          severity: 'medium',
          cvss: 5.0,
          title: 'Rate limiting is not explicitly enabled',
          description: 'Rate limiting configuration not found in settings. Without it, the gateway is more susceptible to abuse.',
          recommendation: 'Enable rate limiting in settings.json or via the Settings UI.',
          new_vs_recurring: 'new',
        })
      }
    }
  } catch {}

  // Check backup status
  try {
    const db = getDatabase()
    const lastBackup = db.prepare(`
      SELECT created_at FROM audit_log WHERE action = 'auto_backup' ORDER BY created_at DESC LIMIT 1
    `).get() as { created_at: number } | undefined

    if (lastBackup) {
      const hoursSince = (Date.now() / 1000 - lastBackup.created_at) / 3600
      if (hoursSince > 72) {
        findings.push({
          number: num++,
          lens: 'defensive',
          severity: 'medium',
          cvss: 5.0,
          title: 'No automated backup in over 72 hours',
          description: `Last backup was ${Math.round(hoursSince)} hours ago. Automated backups should run daily.`,
          recommendation: 'Check scheduler status. Verify backup disk is not full. Check logs for backup errors.',
          new_vs_recurring: 'recurring',
        })
      }
    } else {
      findings.push({
        number: num++,
        lens: 'defensive',
        severity: 'high',
        cvss: 7.0,
        title: 'No automated backup record found',
        description: 'There is no evidence of any automated backup having run. Data loss risk is elevated.',
        recommendation: 'Enable auto_backup in Settings → Infrastructure. Verify backup directory is writable.',
        new_vs_recurring: 'new',
      })
    }
  } catch {}

  // Check for failed login attempts in recent activity
  try {
    const db = getDatabase()
    const since = Math.floor(Date.now() / 1000) - 86400
    const failedLogins = db.prepare(`
      SELECT COUNT(*) as cnt FROM audit_log
      WHERE action = 'login_failed' AND created_at >= ?
    `).get(since) as { cnt: number }

    if (failedLogins.cnt > 10) {
      findings.push({
        number: num++,
        lens: 'defensive',
        severity: 'high',
        cvss: 7.0,
        title: `High volume of failed login attempts (${failedLogins.cnt} in 24h)`,
        description: `${failedLogins.cnt} failed login attempts detected in the last 24 hours. This suggests possible brute-force activity.`,
        recommendation: 'Review the source IPs of failed logins. Consider implementing IP-based blocking or requiring 2FA.',
        new_vs_recurring: 'new',
      })
    }
  } catch {}

  return findings
}

// ---------------------------------------------------------------------------
// Lens 3: Privacy (data handling)
// ---------------------------------------------------------------------------

function runPrivacyLens(): Finding[] {
  const findings: Finding[] = []
  let num = 200
  const openclawHome = config.openclawHome || process.env.OPENCLAW_HOME || join(process.env.HOME || '/root', '.openclaw')

  // Check if PHI/PII-adjacent data is in memory files
  const piiPatterns = [
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/, name: 'SSN' },
    { pattern: /\b\d{16}\b/, name: 'Credit card number' },
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, name: 'Email address', threshold: 5 },
  ]

  const memoryDir = join(openclawHome, 'workspace', 'memory')
  let piiCount = 0
  try {
    const entries = readdirSync(memoryDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      try {
        const content = readFileSync(join(memoryDir, entry.name), 'utf-8')
        for (const { pattern, name, threshold = 1 } of piiPatterns) {
          const matches = content.match(pattern)
          if (matches && matches.length >= threshold) {
            piiCount += matches.length
          }
        }
      } catch {}
    }
  } catch {}

  if (piiCount > 0) {
    findings.push({
      number: num++,
      lens: 'privacy',
      severity: 'medium',
      cvss: 5.5,
      title: `Potential PII detected in memory files (${piiCount} matches)`,
      description: 'Patterns resembling SSNs, credit card numbers, or bulk email addresses were found in memory files. These may be false positives but should be reviewed.',
      recommendation: 'Review ~/.openclaw/workspace/memory/ files. Remove or mask any genuine PII. Avoid storing raw PII in agent memory.',
      new_vs_recurring: 'new',
    })
  }

  // Check for third-party data exfiltration risk (webhook destinations)
  try {
    const db = getDatabase()
    const webhooks = db.prepare('SELECT name, url FROM webhooks WHERE enabled = 1').all() as Array<{ name: string; url: string }>
    const suspiciousDomains = ['pastebin', 'hastebin', 'ipinfo', 'ip-api']
    for (const wh of webhooks) {
      for (const dom of suspiciousDomains) {
        if (wh.url.includes(dom)) {
          findings.push({
            number: num++,
            lens: 'privacy',
            severity: 'high',
            cvss: 7.5,
            title: `Webhook "${wh.name}" points to ${dom}`,
            description: `An enabled webhook POSTs data to ${wh.url}. This could constitute unintended data exfiltration if the destination is untrusted.`,
            recommendation: 'Review the webhook URL. Only use webhooks pointing to services you control or explicitly trust.',
            source_file: wh.url,
            new_vs_recurring: 'new',
          })
        }
      }
    }
  } catch {}

  return findings
}

// ---------------------------------------------------------------------------
// Lens 4: Operational Realism (security theater vs real?)
// ---------------------------------------------------------------------------

function runOperationalRealismLens(): Finding[] {
  const findings: Finding[] = []
  let num = 300

  // Check agent-to-agent auth is configured
  try {
    const db = getDatabase()
    const agentsWithoutAuth = db.prepare(`
      SELECT COUNT(*) as cnt FROM agents WHERE config IS NULL OR config = ''
    `).get() as { cnt: number }

    if (agentsWithoutAuth.cnt > 3) {
      findings.push({
        number: num++,
        lens: 'operational',
        severity: 'low',
        cvss: 2.5,
        title: 'Multiple agents without explicit auth config',
        description: `${agents_withoutAuth.cnt} agents lack explicit auth configuration. This may be intentional for local-only agents, but verify.`,
        recommendation: 'For each agent, confirm it is intentionally unauthenticated and confined to loopback access.',
        new_vs_recurring: 'recurring',
      })
    }
  } catch {}

  // Check skill integrity (are installed skills actually parseable?)
  try {
    const skillsDir = join(config.openclawHome || process.env.OPENCLAW_HOME || '', 'skills')
    if (existsSync(skillsDir)) {
      const entries = readdirSync(skillsDir, { withFileTypes: true })
      let brokenSkills = 0
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const skillMd = join(skillsDir, entry.name, 'SKILL.md')
        if (!existsSync(skillMd)) {
          brokenSkills++
        } else {
          try {
            const content = readFileSync(skillMd, 'utf-8')
            if (content.length < 50) brokenSkills++
          } catch {
            brokenSkills++
          }
        }
      }
      if (brokenSkills > 0) {
        findings.push({
          number: num++,
          lens: 'operational',
          severity: 'low',
          cvss: 2.0,
          title: `${brokenSkills} skill(s) with missing or empty SKILL.md`,
          description: 'These skills may still load but lack proper documentation and safety constraints defined in SKILL.md.',
          recommendation: 'Review broken skills. Either add a proper SKILL.md or uninstall the skill to prevent undefined behavior.',
          new_vs_recurring: 'new',
        })
      }
    }
  } catch {}

  // Check .env file permissions (should be readable only by owner)
  try {
    const envPath = join(config.openclawHome || process.env.HOME || '/root', '.openclaw', '.env')
    if (existsSync(envPath)) {
      const stat = require('fs').statSync(envPath)
      const mode = stat.mode & 0o777
      if ((mode & 0o077) !== 0) {
        findings.push({
          number: num++,
          lens: 'operational',
          severity: 'high',
          cvss: 7.0,
          title: '.env file has overly permissive permissions',
          description: `.env is readable by group/other (mode ${mode.toString(8)}). This is a world-readable risk.`,
          recommendation: 'Run `chmod 600 ~/.openclaw/.env` to restrict to owner-only.',
          source_file: envPath,
          new_vs_recurring: 'new',
        })
      }
    }
  } catch {}

  return findings
}

// ---------------------------------------------------------------------------
// Telegram alert
// ---------------------------------------------------------------------------

async function sendTelegramAlert(findings: Finding[]): Promise<void> {
  const critical = findings.filter(f => f.cvss !== undefined && f.cvss >= 7)
  if (critical.length === 0) return

  const lines = [
    '🚨 *Security Council — Critical Findings*',
    `${critical.length} critical finding(s) require immediate attention:\n`,
  ]
  for (const f of critical.slice(0, 5)) {
    lines.push(`*#${f.number} [${f.lens.toUpperCase()}] ${f.title}*`)
    lines.push(`Severity: ${f.severity} (CVSS ${f.cvss})`)
    lines.push(`→ ${f.recommendation}`)
    lines.push('')
  }

  const body = lines.join('\n')
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: body, parse_mode: 'Markdown' }),
    })
    logger.info({ critical: critical.length }, 'Security Council: Telegram alert sent')
  } catch (err) {
    logger.error({ err }, 'Security Council: Telegram alert failed')
  }
}

// ---------------------------------------------------------------------------
// Diff against previous run
// ---------------------------------------------------------------------------

function getPreviousFindings(): Finding[] {
  try {
    const db = getDatabase()
    const prev = db.prepare(`
      SELECT findings_json FROM security_audit_log
      ORDER BY run_at DESC LIMIT 1, 1
    `).get() as { findings_json: string } | undefined
    if (prev) return JSON.parse(prev.findings_json)
  } catch {}
  return []
}

function diffFindings(previous: Finding[], current: Finding[]): Finding[] {
  const prevMap = new Map(previous.map(f => [f.title, f]))
  return current.map(f => ({
    ...f,
    new_vs_recurring: prevMap.has(f.title) ? 'recurring' : 'new',
  }))
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

export async function runSecurityCouncil(): Promise<AuditRun> {
  logger.info('Security Council: starting nightly audit')
  const start = Date.now()

  const previous = getPreviousFindings()
  const allFindings: Finding[] = []

  // Run all 4 lenses in sequence
  const offensiveFindings = runOffensiveLens()
  const defensiveFindings = runDefensiveLens()
  const privacyFindings = runPrivacyLens()
  const operationalFindings = runOperationalRealismLens()

  allFindings.push(...offensiveFindings, ...defensiveFindings, ...privacyFindings, ...operationalFindings)

  // Diff to determine new vs recurring
  const diffedFindings = diffFindings(previous, allFindings)

  // Sort by severity then number
  diffedFindings.sort((a, b) => {
    const cvssA = a.cvss ?? severityToCVSS(a.severity)
    const cvssB = b.cvss ?? severityToCVSS(b.severity)
    return cvssB - cvssA
  })
  // Re-number after sort
  diffedFindings.forEach((f, i) => { f.number = i + 1 })

  const critical_count = diffedFindings.filter(f => f.severity === 'critical').length
  const high_count = diffedFindings.filter(f => f.severity === 'high').length
  const medium_count = diffedFindings.filter(f => f.severity === 'medium').length
  const low_count = diffedFindings.filter(f => f.severity === 'low' || f.severity === 'info').length

  const summary = [
    `${diffedFindings.length} total findings`,
    `${critical_count} critical, ${high_count} high, ${medium_count} medium, ${low_count} low/info`,
    `${diffedFindings.filter(f => f.new_vs_recurring === 'new').length} new`,
    `${diffedFindings.filter(f => f.new_vs_recurring === 'recurring').length} recurring`,
  ].join(' | ')

  // Persist
  try {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO security_audit_log (run_at, findings_json, summary_json, critical_count, high_count, medium_count, low_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      Math.floor(Date.now() / 1000),
      JSON.stringify(diffedFindings),
      JSON.stringify({ summary, lenses: { offensive: offensiveFindings.length, defensive: defensiveFindings.length, privacy: privacyFindings.length, operational: operationalFindings.length } }),
      critical_count, high_count, medium_count, low_count
    )
  } catch (err) {
    logger.error({ err }, 'Security Council: failed to persist results')
  }

  // Immediate Telegram for critical findings
  await sendTelegramAlert(diffedFindings)

  const duration_ms = Date.now() - start
  logger.info({ findings: diffedFindings.length, critical_count, duration_ms }, 'Security Council: audit complete')

  return {
    run_at: Math.floor(Date.now() / 1000),
    findings: diffedFindings,
    critical_count,
    high_count,
    medium_count,
    low_count,
    summary,
  }
}

// ---------------------------------------------------------------------------
// Latest audit (for API)
// ---------------------------------------------------------------------------

export function getLatestSecurityAudit(): AuditRun | null {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT run_at, findings_json, summary_json, critical_count, high_count, medium_count, low_count
      FROM security_audit_log ORDER BY run_at DESC LIMIT 1
    `).get() as {
      run_at: number
      findings_json: string
      summary_json: string
      critical_count: number
      high_count: number
      medium_count: number
      low_count: number
    } | undefined

    if (!row) return null

    return {
      run_at: row.run_at,
      findings: JSON.parse(row.findings_json),
      critical_count: row.critical_count,
      high_count: row.high_count,
      medium_count: row.medium_count,
      low_count: row.low_count,
      summary: JSON.parse(row.summary_json).summary ?? '',
    }
  } catch {
    return null
  }
}

export function getPreviousAudit(): AuditRun | null {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT run_at, findings_json, summary_json, critical_count, high_count, medium_count, low_count
      FROM security_audit_log ORDER BY run_at DESC LIMIT 1 OFFSET 1
    `).get() as {
      run_at: number
      findings_json: string
      summary_json: string
      critical_count: number
      high_count: number
      medium_count: number
      low_count: number
    } | undefined

    if (!row) return null

    return {
      run_at: row.run_at,
      findings: JSON.parse(row.findings_json),
      critical_count: row.critical_count,
      high_count: row.high_count,
      medium_count: row.medium_count,
      low_count: row.low_count,
      summary: JSON.parse(row.summary_json).summary ?? '',
    }
  } catch {
    return null
  }
}
