import type { AnyScenario } from '../scenario.js'

export type RunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'interrupted'

export interface StepResult {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: { message: string }
}

export type ArtifactKind = 'screenshot' | 'trace'

export interface Artifact {
  kind: ArtifactKind
  name: string
  url: string
}

export interface RunResult {
  runId: string
  scenarioId: string
  status: RunStatus
  params: unknown
  queuedAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  steps: StepResult[]
  data: unknown
  error: { message: string; stack?: string } | null
  artifacts: Artifact[]
}

export interface RunMeta {
  runId: string
  scenarioId: string
  params: unknown
  queuedAt: string
}

export interface RunJob {
  runId: string
  scenario: AnyScenario
  params: unknown
  queuedAt: string
}
