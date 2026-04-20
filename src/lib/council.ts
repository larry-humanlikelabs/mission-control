/**
 * Business Advisory Council — Module 5.1
 * 
 * 8 specialist agents running in parallel.
 * Each sees only their domain data.
 * Synthesizer merges into ranked digest.
 */

import { getDatabase } from '@/lib/db'

// 8 Specialist Roles
export const COUNCIL_MEMBERS = [
  { id: 'revenue_guardian', name: 'RevenueGuardian', persona: 'Hormozi Consultant', specialty: 'Revenue & Pricing', dataScope: ['revenue', 'pricing', 'transactions', 'subscriptions'] },
  { id: 'growth_strategist', name: 'GrowthStrategist', persona: 'Ralston Brand Strategist', specialty: 'Growth & Brand', dataScope: ['marketing', 'campaigns', 'leads', 'brand'] },
  { id: 'skeptical_operator', name: 'SkepticalOperator', persona: 'Business X-Ray', specialty: 'Business Analysis', dataScope: ['metrics', 'performance', 'kpis', 'analytics'] },
  { id: 'content_council', name: 'ContentCouncil', persona: 'Content Strategist', specialty: 'Content Metrics', dataScope: ['content', 'engagement', 'views', 'posts'] },
  { id: 'sales_ops', name: 'SalesOps', persona: 'NEPQ Sales', specialty: 'Sales Operations', dataScope: ['sales', 'pipeline', 'deals', 'conversions'] },
  { id: 'product_pulse', name: 'ProductPulse', persona: 'Product Manager', specialty: 'Product Health', dataScope: ['product', 'features', 'users', 'feedback'] },
  { id: 'people_ops', name: 'PeopleOps', persona: 'HR Lead', specialty: 'Team & Culture', dataScope: ['team', 'agents', 'tasks', 'workload'] },
  { id: 'finance_hawk', name: 'FinanceHawk', persona: 'Fractional CFO', specialty: 'Finance & Burn', dataScope: ['costs', 'burn', 'budget', 'financials'] },
]

export interface CouncilFinding {
  number: number
  title: string
  priority: 1 | 2 | 3 | 4 | 5
  raised_by: string
  why_it_matters: string
  recommended_action: string
  data_evidence: string[]
  confidence: number // 0-1
}

export interface CouncilRun {
  date: string
  findings: CouncilFinding[]
  agents_run: string[]
  duration_ms: number
  timestamp: number
}

interface SpecialistReport {
  agentId: string
  findings: string[]
  data_used: string[]
  confidence: number
}

// Each specialist runs with a narrow data scope
async function runSpecialist(specialist: typeof COUNCIL_MEMBERS[0]): Promise<SpecialistReport> {
  const db = getDatabase()
  
  // Fetch only relevant data for this specialist
  const relevantData = fetchRelevantData(db, specialist.dataScope)
  
  // Build specialist prompt
  const prompt = buildSpecialistPrompt(specialist, relevantData)
  
  // In production, this would spawn a sub-agent with the persona
  // For now, generate structured findings from the data
  const findings = analyzeDataForSpecialist(specialist, relevantData)
  
  return {
    agentId: specialist.id,
    findings: findings.textual,
    data_used: relevantData.summary,
    confidence: findings.confidence
  }
}

function fetchRelevantData(db: any, scope: string[]): any {
  const summary: string[] = []
  const data: Record<string, any> = {}

  // Revenue data
  if (scope.includes('revenue') || scope.includes('pricing')) {
    try {
      const costs = db.prepare('SELECT SUM(cost_usd) as total FROM model_calls WHERE created_at > ?').get(Math.floor(Date.now() / 1000) - 86400 * 30)
      data.revenue = { last_30d_cost: costs?.total || 0 }
      summary.push(`Last 30d cost: $${(costs?.total || 0).toFixed(2)}`)
    } catch {}
  }

  // Task data
  if (scope.includes('tasks') || scope.includes('workload')) {
    try {
      const taskStats = db.prepare(`
        SELECT status, COUNT(*) as count FROM tasks GROUP BY status
      `).all()
      data.tasks = taskStats
      summary.push(`Tasks: ${taskStats.map((t: any) => `${t.count} ${t.status}`).join(', ')}`)
    } catch {}
  }

  // Activity data
  if (scope.includes('metrics') || scope.includes('performance')) {
    try {
      const recentActivity = db.prepare(`
        SELECT COUNT(*) as count FROM activities WHERE created_at > ?
      `).get(Math.floor(Date.now() / 1000) - 86400)
      data.activity = recentActivity
      summary.push(`Last 24h activities: ${recentActivity?.count || 0}`)
    } catch {}
  }

  // Content data
  if (scope.includes('content') || scope.includes('engagement')) {
    try {
      const ideas = db.prepare('SELECT COUNT(*) as count FROM idea_archive WHERE status = ?').get('pending')
      data.content = { pending_ideas: ideas?.count || 0 }
      summary.push(`Pending ideas: ${ideas?.count || 0}`)
    } catch {}
  }

  return { summary, data }
}

function buildSpecialistPrompt(specialist: typeof COUNCIL_MEMBERS[0], relevantData: any): string {
  return `
You are ${specialist.name}, a ${specialist.specialty} specialist.
Persona: ${specialist.persona}

Analyze this data and produce 1-3 findings:
${relevantData.summary.map((s: string) => `- ${s}`).join('\n')}

For each finding, provide:
1. Title (what it is)
2. Why it matters (business impact)
3. Recommended action (specific next step)
4. Data evidence (cite specific numbers)

Keep findings actionable and specific.
`
}

function analyzeDataForSpecialist(specialist: typeof COUNCIL_MEMBERS[0], relevantData: any): { textual: string[]; confidence: number } {
  const findings: string[] = []
  let confidence = 0.5

  // RevenueGuardian
  if (specialist.id === 'revenue_guardian') {
    const cost = relevantData.data.revenue?.last_30d_cost || 0
    if (cost > 100) {
      findings.push(`High AI spend detected: $${cost.toFixed(2)} in last 30 days. Consider optimizing model usage or switching to lower-cost models for non-critical tasks.`)
      confidence = 0.8
    }
  }

  // GrowthStrategist
  if (specialist.id === 'growth_strategist') {
    const pending = relevantData.data.content?.pending_ideas || 0
    if (pending < 5) {
      findings.push(`Low content pipeline: only ${pending} pending ideas. Consider running ideation engine to replenish pipeline.`)
      confidence = 0.7
    }
  }

  // SkepticalOperator
  if (specialist.id === 'skeptical_operator') {
    const activity = relevantData.data.activity?.count || 0
    if (activity === 0) {
      findings.push(`No activity in last 24h. Verify agents are running and tasks are being processed.`)
      confidence = 0.9
    }
  }

  // FinanceHawk
  if (specialist.id === 'finance_hawk') {
    const cost = relevantData.data.revenue?.last_30d_cost || 0
    const projectedMonthly = cost * 30
    findings.push(`Monthly burn projection: $${projectedMonthly.toFixed(2)}. At current rate, monthly AI cost will be ~$${projectedMonthly.toFixed(0)}.`)
    confidence = 0.85
  }

  return { textual: findings, confidence }
}

// Synthesize all specialist reports into ranked digest
function synthesize(reports: SpecialistReport[]): CouncilFinding[] {
  const findings: CouncilFinding[] = []
  let findingNum = 1

  for (const report of reports) {
    for (const finding of report.findings) {
      findings.push({
        number: findingNum++,
        title: finding.substring(0, 80),
        priority: determinePriority(finding, report.confidence),
        raised_by: report.agentId,
        why_it_matters: extractWhyMatters(finding),
        recommended_action: extractAction(finding),
        data_evidence: report.data_used,
        confidence: report.confidence
      })
    }
  }

  // Sort by priority (1=highest)
  findings.sort((a, b) => a.priority - b.priority)

  // Re-number after sort
  findings.forEach((f, i) => f.number = i + 1)

  return findings
}

function determinePriority(finding: string, confidence: number): 1 | 2 | 3 | 4 | 5 {
  const lower = finding.toLowerCase()
  if (lower.includes('critical') || lower.includes('urgent')) return 1
  if (lower.includes('high') || confidence > 0.8) return 2
  if (lower.includes('consider') || lower.includes('should')) return 3
  return 4
}

function extractWhyMatters(finding: string): string {
  // Simple extraction - in production would use LLM
  const parts = finding.split('.')
  return parts.slice(1).join('.').trim() || finding
}

function extractAction(finding: string): string {
  if (finding.includes('Consider')) {
    return finding.split('Consider')[1]?.split('.')[0]?.trim() || 'Review and decide'
  }
  if (finding.includes('Verify')) return 'Check system status'
  return 'Review finding and take appropriate action'
}

// Main council runner
export async function runBusinessCouncil(): Promise<CouncilRun> {
  const startTime = Date.now()
  
  // Run all specialists in parallel
  const reports = await Promise.all(
    COUNCIL_MEMBERS.map(specialist => runSpecialist(specialist))
  )

  // Synthesize into ranked digest
  const findings = synthesize(reports)

  const run: CouncilRun = {
    date: new Date().toISOString().split('T')[0],
    findings,
    agents_run: reports.map(r => r.agentId),
    duration_ms: Date.now() - startTime,
    timestamp: Date.now()
  }

  // Save to database
  const db = getDatabase()
  db.prepare(`
    INSERT INTO council_runs (date, findings, agents_run, duration_ms, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    run.date,
    JSON.stringify(findings),
    JSON.stringify(run.agents_run),
    run.duration_ms,
    run.timestamp
  )

  return run
}
