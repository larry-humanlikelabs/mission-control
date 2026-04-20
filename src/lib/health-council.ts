/**
 * health-council.ts — Weekly Platform Health Council
 *
 * 9 checks:
 * 1. Cron health
 * 2. Code quality (eslint)
 * 3. Test coverage
 * 4. Prompt drift / quality
 * 5. Dependency vulnerabilities (npm audit)
 * 6. Storage growth
 * 7. Skill integrity
 * 8. Config consistency
 * 9. Memory / contact DB integrity
 *
 * Philosophy: silence is good. Only report problems.
 * Stored in health_audit_log. GET /api/health returns latest audit.
 */

import { getDatabase } from './db'
import { logger } from './logger'
import { config } from './config'
import { join, basename, dirname } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { execSync } from 'child_process'

export interface HealthFinding {
  number: number
  area: string
  severity: 'warning' | 'critical'
  title: string
  description: string
  recommendation: string
  detail?: string
}

export interface HealthAuditRun {
  run_at: number
  findings: HealthFinding[]
  healthy_count: number
  warning_count: number
  critical_count: number
  summary: string
  checks: Record<string, 'pass' | 'warning' | 'critical'>
}

// ---------------------------------------------------------------------------
// Check 1: Cron Health
// ---------------------------------------------------------------------------

function checkCronHealth(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  try {
    const db = getDatabase()
    const since = Math.floor(Date.now() / 1000) - 86400 * 7 // last 7 days

    // Check scheduler tasks — look at recent audit log entries for failures
    const failedTasks = db.prepare(`
      SELECT action, COUNT(*) as cnt FROM audit_log
      WHERE action LIKE '%failed%' OR action LIKE '%error%'
      AND created_at >= ?
      GROUP BY action
    `).all(since) as Array<{ action: string; cnt: number }>

    if (failedTasks.length > 20) {
      findings.push({
        number: num++,
        area: 'cron',
        severity: 'warning',
        title: 'High volume of task failures in the past week',
        description: `${failedTasks.reduce((s, r) => s + r.cnt, 0)} failed/error events in 7 days.`,
        recommendation: 'Review individual task failures in the Activity Feed. Identify recurring failure patterns.',
      })
    }

    // Check for jobs that should have run recently but didn't
    const scheduledTasks = db.prepare(`
      SELECT action, MAX(created_at) as last_run FROM audit_log
      WHERE action NOT LIKE '%login%' AND created_at >= ?
      GROUP BY action
    `).all(since) as Array<{ action: string; last_run: number }>

    // Identify potential stale jobs
    const openclawHome = config.openclawHome || process.env.OPENCLAW_HOME || ''
    const cronJobsPath = join(openclawHome, 'cron', 'jobs.json')
    if (existsSync(cronJobsPath)) {
      try {
        const cronData = JSON.parse(readFileSync(cronJobsPath, 'utf-8')) as { jobs: Array<{ name: string; enabled: boolean; state?: { lastRunAtMs?: number } }> }
        const now = Date.now()
        for (const job of cronData.jobs ?? []) {
          if (!job.enabled) continue
          const lastRun = job.state?.lastRunAtMs ?? 0
          const hoursSinceRun = lastRun ? (now - lastRun) / 3600000 : null
          // If a job hasn't run in 3x its expected interval (assume minimum 1h), flag it
          if (hoursSinceRun !== null && hoursSinceRun > 72) {
            findings.push({
              number: num++,
              area: 'cron',
              severity: 'warning',
              title: `Cron job "${job.name}" hasn't run in ${Math.round(hoursSinceRun)} hours`,
              description: `Last run: ${lastRun ? new Date(lastRun).toISOString() : 'never'}. Job may be broken.`,
              recommendation: `Check the cron job "${job.name}" in openclaw cron list. Verify the agent is responsive and the schedule is valid.`,
            })
          }
        }
      } catch {}
    }
  } catch (err: any) {
    findings.push({
      number: num++,
      area: 'cron',
      severity: 'warning',
      title: 'Could not read cron health data',
      description: `Error: ${err.message}`,
      recommendation: 'Verify the database is accessible and migrations have run.',
    })
  }

  return findings.length === 0
    ? { status: 'pass', findings: [] }
    : { status: 'warning', findings }
}

// ---------------------------------------------------------------------------
// Check 2: Code Quality (eslint)
// ---------------------------------------------------------------------------

function checkCodeQuality(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  try {
    const output = execSync('pnpm lint --format=json 2>/dev/null || true', {
      cwd: process.cwd(),
      timeout: 60_000,
      encoding: 'utf-8',
    })

    interface EslintResult { errorCount?: number; warningCount?: number; messages?: Array<{ severity: number; message: string; file?: string }> }
    let eslintData: EslintResult = {}
    try { eslintData = JSON.parse(output) } catch {}

    const errors = eslintData.errorCount ?? 0
    const warnings = eslintData.warningCount ?? 0

    if (errors > 0) {
      findings.push({
        number: num++,
        area: 'code_quality',
        severity: 'critical',
        title: `${errors} ESLint error(s) in codebase`,
        description: `${errors} errors, ${warnings} warnings. These will fail the build.`,
        recommendation: 'Run `pnpm lint` locally to see error details. Fix all errors before deploying.',
        detail: eslintData.messages?.slice(0, 5).map(m => `${m.file}: ${m.message}`).join('\n'),
      })
    } else if (warnings > 20) {
      findings.push({
        number: num++,
        area: 'code_quality',
        severity: 'warning',
        title: `${warnings} ESLint warnings in codebase`,
        description: 'High warning count. Consider addressing the top warnings.',
        recommendation: 'Run `pnpm lint` to see details. Prioritize warnings in frequently-edited files.',
      })
    }
  } catch (err: any) {
    // If lint fails to run at all, that's a finding
    findings.push({
      number: num++,
      area: 'code_quality',
      severity: 'warning',
      title: 'Could not run ESLint',
      description: `Lint command exited with error: ${err.message}`,
      recommendation: 'Verify pnpm and eslint are installed. Check for missing peer dependencies.',
    })
  }

  return findings.length === 0
    ? { status: 'pass', findings: [] }
    : findings.some(f => f.severity === 'critical')
      ? { status: 'critical', findings }
      : { status: 'warning', findings }
}

// ---------------------------------------------------------------------------
// Check 3: Test Coverage
// ---------------------------------------------------------------------------

function checkTestCoverage(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  try {
    const output = execSync('pnpm test --run --coverage 2>/dev/null || true', {
      cwd: process.cwd(),
      timeout: 120_000,
      encoding: 'utf-8',
    })

    // Parse coverage from output (vitest produces % coverage in output)
    const coverageMatch = output.match(/All files[^%]*(\d+\.\d+) %/)
    const coveragePct = coverageMatch ? parseFloat(coverageMatch[1]) : null

    if (coveragePct !== null && coveragePct < 50) {
      findings.push({
        number: num++,
        area: 'test_coverage',
        severity: 'critical',
        title: `Test coverage is ${coveragePct}% (below 50% threshold)`,
        description: `Low test coverage increases risk of undetected regressions.`,
        recommendation: 'Add unit tests for untested modules, especially in src/lib/. Target 60%+ coverage.',
      })
    } else if (coveragePct !== null && coveragePct < 70) {
      findings.push({
        number: num++,
        area: 'test_coverage',
        severity: 'warning',
        title: `Test coverage is ${coveragePct}% (below 70% target)`,
        description: 'Coverage is moderate. Aim for 70%+ to reduce regression risk.',
        recommendation: 'Identify lowest-coverage files with `pnpm test --coverage`. Add tests for critical paths.',
      })
    }
  } catch (err: any) {
    findings.push({
      number: num++,
      area: 'test_coverage',
      severity: 'warning',
      title: 'Could not run test coverage',
      description: `Tests exited with: ${err.message}`,
      recommendation: 'Verify tests run successfully with `pnpm test`. Fix any failing tests immediately.',
    })
  }

  return { status: findings.length === 0 ? 'pass' : findings[0].severity === 'critical' ? 'critical' : 'warning', findings }
}

// ---------------------------------------------------------------------------
// Check 4: Prompt Drift
// ---------------------------------------------------------------------------

function checkPromptDrift(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  const openclawHome = config.openclawHome || process.env.OPENCLAW_HOME || join(process.env.HOME || '/root', '.openclaw')
  const agentFiles = [
    'SOUL.md', 'AGENTS.md', 'CONSCIOUSNESS.md',
  ]

  const aiTells = [
    { pattern: /\bat the end of the day\b/gi, name: '"at the end of the day"' },
    { pattern: /\bthe fact of the matter is\b/gi, name: '"the fact of the matter is"' },
    { pattern: /\bit is important to note that\b/gi, name: '"it is important to note that"' },
    { pattern: /\btov?\s*\.\s*\.\s*\./g, name: 'excessive hedging (tov...)' },
    { pattern: /\b[C]{5,}/g, name: 'excessive capitals' },
    { pattern: /\[MUTED\]|\[SILENCED\]|\[REDACTED\]/gi, name: 'muted/silenced/redacted markers' },
  ]

  for (const file of agentFiles) {
    const path = join(openclawHome, 'workspace', file)
    if (!existsSync(path)) continue

    try {
      const content = readFileSync(path, 'utf-8')
      for (const { pattern, name } of aiTells) {
        const matches = content.match(pattern)
        if (matches && matches.length >= 2) {
          findings.push({
            number: num++,
            area: 'prompt_drift',
            severity: 'warning',
            title: `AI writing tell detected in ${file}: ${name}`,
            description: `"${name}" appears ${matches.length} times in ${file}. This is an AI writing tell that reduces authenticity.`,
            recommendation: `Edit ${file} and replace "${name}" patterns with direct, natural language.`,
          })
        }
      }
    } catch {}
  }

  return findings.length === 0
    ? { status: 'pass', findings: [] }
    : { status: 'warning', findings }
}

// ---------------------------------------------------------------------------
// Check 5: Dependency Vulnerabilities
// ---------------------------------------------------------------------------

function checkDependencyVulns(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  try {
    const output = execSync('npm audit --json 2>/dev/null || pnpm audit --json 2>/dev/null || true', {
      cwd: process.cwd(),
      timeout: 60_000,
      encoding: 'utf-8',
    })

    interface AuditData { metadata?: { vulnerabilities?: { critical?: number; high?: number; medium?: number; low?: number } } }
    let auditData: AuditData = {}
    try { auditData = JSON.parse(output) } catch {}

    const vulns = auditData.metadata?.vulnerabilities ?? {}
    const critical = vulns.critical ?? 0
    const high = vulns.high ?? 0
    const medium = vulns.medium ?? 0

    if (critical > 0) {
      findings.push({
        number: num++,
        area: 'dependencies',
        severity: 'critical',
        title: `${critical} critical dependency vulnerability (CVSS 9-10)`,
        description: `npm/pnpm audit found ${critical} critical, ${high} high, ${medium} medium vulnerabilities.`,
        recommendation: 'Run `pnpm audit fix` for automatic fixes. Review critical vulns manually. Do not deploy until critical vulns are resolved.',
      })
    } else if (high > 0) {
      findings.push({
        number: num++,
        area: 'dependencies',
        severity: 'warning',
        title: `${high} high-severity dependency vulnerability`,
        description: `${high} high, ${medium} medium vulnerabilities in dependencies.`,
        recommendation: 'Run `pnpm audit fix`. If any fail, update affected packages manually. Re-test after updates.',
      })
    }
  } catch {
    // npm audit might not be available — skip silently
  }

  return findings.length === 0
    ? { status: 'pass', findings: [] }
    : { status: findings[0].severity, findings }
}

// ---------------------------------------------------------------------------
// Check 6: Storage Growth
// ---------------------------------------------------------------------------

function checkStorageGrowth(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  const openclawHome = config.openclawHome || process.env.OPENCLAW_HOME || join(process.env.HOME || '/root', '.openclaw')
  const dbPath = config.dbPath

  interface DirSize { path: string; sizeMB: number; prevSizeMB?: number; growthPct?: number }

  const measureDir = (dir: string): number => {
    try {
      let total = 0
      const walk = (d: string): void => {
        try {
          for (const entry of readdirSync(d, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue
            const full = join(d, entry.name)
            if (entry.isDirectory()) {
              walk(full)
            } else {
              try { total += statSync(full).size } catch {}
            }
          }
        } catch {}
      }
      walk(dir)
      return total
    } catch { return 0 }
  }

  const dbDir = join(dirname(dbPath))
  const currentSize = measureDir(dbDir)

  // Read previous size from meta table
  let prevSize = 0
  try {
    const db = getDatabase()
    const row = db.prepare('SELECT value FROM health_audit_log WHERE id = -1').get() as { value: string } | undefined
    if (row) {
      const meta = JSON.parse(row.value)
      prevSize = meta?.dbSizeMB ?? 0
    }
  } catch {}

  const currentSizeMB = currentSize / 1024 / 1024
  const prevSizeMB = prevSize || currentSizeMB
  const growthPct = prevSize ? ((currentSizeMB - prevSizeMB) / prevSizeMB) * 100 : 0

  if (growthPct > 20) {
    findings.push({
      number: num++,
      area: 'storage',
      severity: 'critical',
      title: `Storage growth exceeded 20% since last check (${growthPct.toFixed(1)}%)`,
      description: `Database directory grew from ${prevSizeMB.toFixed(1)}MB to ${currentSizeMB.toFixed(1)}MB. Unchecked growth can fill disk.`,
      recommendation: 'Run cleanup (`pnpm cleanup` or openclaw cleanup). Check for bloated logs or un-pruned sessions.',
    })
  } else if (growthPct > 10) {
    findings.push({
      number: num++,
      area: 'storage',
      severity: 'warning',
      title: `Storage growth ${growthPct.toFixed(1)}% since last check`,
      description: `Database directory at ${currentSizeMB.toFixed(1)}MB (was ${prevSizeMB.toFixed(1)}MB).`,
      recommendation: 'Monitor storage trend. If growth continues, run cleanup and prune old sessions.',
    })
  }

  // Check disk free space
  try {
    const diskInfo = execSync('df -m / | tail -1 2>/dev/null || true', { encoding: 'utf-8' })
    const parts = diskInfo.trim().split(/\s+/)
    const freeMB = parseInt(parts[3]) || 0
    if (freeMB < 500) {
      findings.push({
        number: num++,
        area: 'storage',
        severity: 'critical',
        title: `Low disk space: ${freeMB}MB remaining`,
        description: 'Less than 500MB free on the root volume. Mission Control may become unresponsive.',
        recommendation: 'Immediately run cleanup. Delete old log files, prune sessions, clear cache. Consider expanding disk.',
      })
    } else if (freeMB < 2000) {
      findings.push({
        number: num++,
        area: 'storage',
        severity: 'warning',
        title: `Moderate disk space: ${freeMB}MB remaining`,
        description: 'Less than 2GB free. Monitor closely.',
        recommendation: 'Plan cleanup soon. Check for large log files or accumulated session data.',
      })
    }
  } catch {}

  return findings.length === 0
    ? { status: 'pass', findings: [] }
    : { status: findings[0].severity, findings }
}

// ---------------------------------------------------------------------------
// Check 7: Skill Integrity
// ---------------------------------------------------------------------------

function checkSkillIntegrity(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  const skillsBase = join(config.openclawHome || process.env.OPENCLAW_HOME || '', 'skills')
  if (!existsSync(skillsBase)) {
    return { status: 'pass', findings: [] }
  }

  try {
    const entries = readdirSync(skillsBase, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = join(skillsBase, entry.name)

      // Check for SKILL.md
      const skillMdPath = join(skillDir, 'SKILL.md')
      if (!existsSync(skillMdPath)) {
        findings.push({
          number: num++,
          area: 'skill_integrity',
          severity: 'warning',
          title: `Skill "${entry.name}" missing SKILL.md`,
          description: 'SKILL.md defines the skill interface, safety constraints, and usage. Without it, behavior is undefined.',
          recommendation: `Add a SKILL.md to ~/.openclaw/skills/${entry.name}/. See existing skills for the format.`,
        })
        continue
      }

      // SKILL.md should be parseable and have required fields
      try {
        const content = readFileSync(skillMdPath, 'utf-8')
        if (content.trim().length < 50) {
          findings.push({
            number: num++,
            area: 'skill_integrity',
            severity: 'warning',
            title: `Skill "${entry.name}" SKILL.md is too short`,
            description: 'SKILL.md appears to be empty or nearly empty. This skill may not load correctly.',
            recommendation: `Populate ~/.openclaw/skills/${entry.name}/SKILL.md with name, description, and usage instructions.`,
          })
        }
      } catch {}
    }
  } catch (err: any) {
    findings.push({
      number: num++,
      area: 'skill_integrity',
      severity: 'warning',
      title: 'Could not scan skills directory',
      description: `Error: ${err.message}`,
      recommendation: 'Verify ~/.openclaw/skills/ is accessible.',
    })
  }

  return findings.length === 0
    ? { status: 'pass', findings: [] }
    : { status: 'warning', findings }
}

// ---------------------------------------------------------------------------
// Check 8: Config Consistency
// ---------------------------------------------------------------------------

function checkConfigConsistency(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  const openclawHome = config.openclawHome || process.env.OPENCLAW_HOME || join(process.env.HOME || '/root', '.openclaw')

  // Check that key files referenced in AGENTS.md actually exist
  const requiredFiles = ['SOUL.md', 'AGENTS.md', 'IDENTITY.md', 'USER.md']
  for (const file of requiredFiles) {
    const path = join(openclawHome, 'workspace', file)
    if (!existsSync(path)) {
      findings.push({
        number: num++,
        area: 'config',
        severity: 'critical',
        title: `Required file missing: ${file}`,
        description: `${file} does not exist in ~/.openclaw/workspace/. This file is required by the agent system.`,
        recommendation: `Create ${file} in ~/.openclaw/workspace/. See the OpenClaw documentation for the required format.`,
      })
    }
  }

  // Check openclaw.json vs workspace files consistency
  const openclawJsonPath = join(openclawHome, 'openclaw.json')
  if (existsSync(openclawJsonPath)) {
    try {
      const cfg = JSON.parse(readFileSync(openclawJsonPath, 'utf-8'))
      if (cfg?.agents) {
        for (const agent of cfg.agents as Array<{ name: string; workspace?: string }>) {
          if (agent.workspace) {
            const wsPath = join(openclawHome, agent.workspace)
            if (!existsSync(wsPath)) {
              findings.push({
                number: num++,
                area: 'config',
                severity: 'warning',
                title: `Agent "${agent.name}" references missing workspace: ${agent.workspace}`,
                description: `Workspace path ${wsPath} does not exist.`,
                recommendation: `Create the workspace directory or update openclaw.json to point to an existing path.`,
              })
            }
          }
        }
      }
    } catch (err: any) {
      findings.push({
        number: num++,
        area: 'config',
        severity: 'warning',
        title: 'openclaw.json is not valid JSON',
        description: `Parse error: ${err.message}`,
        recommendation: 'Fix the JSON syntax in ~/.openclaw/openclaw.json.',
      })
    }
  }

  return findings.length === 0
    ? { status: 'pass', findings: [] }
    : { status: findings[0].severity, findings }
}

// ---------------------------------------------------------------------------
// Check 9: Memory / Contact DB Integrity
// ---------------------------------------------------------------------------

function checkMemoryIntegrity(): { status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] } {
  const findings: HealthFinding[] = []
  let num = 1

  const db = getDatabase()

  // Check search_index freshness
  try {
    const lastIndexed = db.prepare(
      'SELECT MAX(indexed_at) as ts FROM search_index'
    ).get() as { ts: number | null } | undefined

    if (!lastIndexed?.ts) {
      findings.push({
        number: num++,
        area: 'memory',
        severity: 'warning',
        title: 'Search index is empty',
        description: 'The search_index table has no records. Global search will return no results.',
        recommendation: 'Trigger the search indexer manually or wait for the next scheduled run.',
      })
    } else {
      const hoursSince = (Date.now() / 1000 - lastIndexed.ts) / 3600
      if (hoursSince > 24) {
        findings.push({
          number: num++,
          area: 'memory',
          severity: 'warning',
          title: `Search index is stale (last indexed ${Math.round(hoursSince)}h ago)`,
          description: 'The search index has not been updated in over 24 hours.',
          recommendation: 'Verify the search indexer cron is running. Check the scheduler status page.',
        })
      }
    }
  } catch (err: any) {
    findings.push({
      number: num++,
      area: 'memory',
      severity: 'warning',
      title: 'Could not check search index health',
      description: `Error: ${err.message}`,
      recommendation: 'Verify the database is accessible and migrations have run.',
    })
  }

  // Check for duplicate memory files (same hash)
  try {
    const dupes = db.prepare(`
      SELECT content_hash, COUNT(*) as cnt FROM search_index
      WHERE content_hash IS NOT NULL
      GROUP BY content_hash HAVING cnt > 1
      LIMIT 10
    `).all() as Array<{ content_hash: string; cnt: number }>

    if (dupes.length > 0) {
      findings.push({
        number: num++,
        area: 'memory',
        severity: 'warning',
        title: `${dupes.length} duplicate content hash(es) in search index`,
        description: 'The same content appears multiple times in the search index, inflating storage.',
        recommendation: 'Run a full re-index to deduplicate. The indexer handles this on re-index.',
      })
    }
  } catch {}

  return findings.length === 0
    ? { status: 'pass', findings: [] }
    : { status: 'warning', findings }
}

// ---------------------------------------------------------------------------
// Main run
// ---------------------------------------------------------------------------

export async function runHealthCouncil(): Promise<HealthAuditRun> {
  logger.info('Health Council: starting weekly audit')
  const start = Date.now()

  const checks = [
    { name: 'cron_health', fn: checkCronHealth },
    { name: 'code_quality', fn: checkCodeQuality },
    { name: 'test_coverage', fn: checkTestCoverage },
    { name: 'prompt_drift', fn: checkPromptDrift },
    { name: 'dependencies', fn: checkDependencyVulns },
    { name: 'storage', fn: checkStorageGrowth },
    { name: 'skill_integrity', fn: checkSkillIntegrity },
    { name: 'config', fn: checkConfigConsistency },
    { name: 'memory', fn: checkMemoryIntegrity },
  ]

  const results: Array<{ name: string; status: 'pass' | 'warning' | 'critical'; findings: HealthFinding[] }> = []
  for (const check of checks) {
    try {
      const result = check.fn()
      results.push({ name: check.name, ...result })
    } catch (err: any) {
      logger.error({ err, check: check.name }, 'Health Council: check threw')
      results.push({ name: check.name, status: 'warning' as const, findings: [{
        number: 0,
        area: check.name,
        severity: 'warning' as const,
        title: `Check "${check.name}" threw an error`,
        description: err.message,
        recommendation: 'Review the check implementation.',
      }]})
    }
  }

  const allFindings: HealthFinding[] = []
  for (const r of results) {
    allFindings.push(...r.findings)
  }

  // Re-number findings sequentially
  allFindings.forEach((f, i) => { f.number = i + 1 })

  const healthy_count = results.filter(r => r.status === 'pass').length
  const warning_count = results.filter(r => r.status === 'warning').length
  const critical_count = results.filter(r => r.status === 'critical').length

  const summary = `${healthy_count}/9 checks passing | ${warning_count} warnings | ${critical_count} critical`

  // Persist
  try {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO health_audit_log (run_at, findings_json, healthy_count, warning_count, critical_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(Math.floor(Date.now() / 1000), JSON.stringify(allFindings), healthy_count, warning_count, critical_count)
  } catch (err) {
    logger.error({ err }, 'Health Council: failed to persist results')
  }

  const duration_ms = Date.now() - start
  logger.info({ healthy_count, warning_count, critical_count, duration_ms }, 'Health Council: audit complete')

  return {
    run_at: Math.floor(Date.now() / 1000),
    findings: allFindings,
    healthy_count,
    warning_count,
    critical_count,
    summary,
    checks: Object.fromEntries(results.map(r => [r.name, r.status])),
  }
}

// ---------------------------------------------------------------------------
// Latest audit (for API)
// ---------------------------------------------------------------------------

export function getLatestHealthAudit(): HealthAuditRun | null {
  try {
    const db = getDatabase()
    const row = db.prepare(`
      SELECT run_at, findings_json, healthy_count, warning_count, critical_count
      FROM health_audit_log ORDER BY run_at DESC LIMIT 1
    `).get() as {
      run_at: number
      findings_json: string
      healthy_count: number
      warning_count: number
      critical_count: number
    } | undefined

    if (!row) return null

    // Reconstruct checks from findings
    const findings: HealthFinding[] = JSON.parse(row.findings_json)
    const checkNames = ['cron_health', 'code_quality', 'test_coverage', 'prompt_drift', 'dependencies', 'storage', 'skill_integrity', 'config', 'memory']
    const checks: Record<string, 'pass' | 'warning' | 'critical'> = {}
    for (const name of checkNames) {
      const checkFindings = findings.filter(f => f.area === name)
      checks[name] = checkFindings.length === 0
        ? 'pass'
        : checkFindings.some(f => f.severity === 'critical')
          ? 'critical'
          : 'warning'
    }

    return {
      run_at: row.run_at,
      findings,
      healthy_count: row.healthy_count,
      warning_count: row.warning_count,
      critical_count: row.critical_count,
      summary: `${row.healthy_count}/9 checks passing | ${row.warning_count} warnings | ${row.critical_count} critical`,
      checks,
    }
  } catch {
    return null
  }
}
