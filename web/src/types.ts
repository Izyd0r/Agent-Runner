export interface BoardColumn {
  id: string
  name: string
  color: string // Mantine color name
  position: number
  isReviewTarget: boolean // finished agent runs move their task here
}

export const COLUMN_COLORS = ['gray', 'blue', 'yellow', 'teal', 'violet', 'red', 'orange', 'pink']

export interface Project {
  id: string
  name: string
  description?: string | null
  gitHubUrl?: string | null
  hasGitHubToken?: boolean
}
export interface Task {
  id: string; title: string; description?: string | null; columnId: string; position: number
  assigneeUserId?: string | null; assigneeAgentId?: string | null
}
export interface Agent { id: string; name: string; model: string; systemPrompt: string; temperature: number }
export interface Member { userId: string; email: string; role: 'Owner' | 'Member' }

export type RunStatus = 'Queued' | 'Running' | 'Succeeded' | 'Failed'

export interface Run {
  id: string
  taskId: string
  agentId: string
  status: RunStatus
  startedAt: string
  finishedAt?: string | null
  branch?: string | null
  pullRequestUrl?: string | null
}

export type RunLog = { id: number; runId: string; at: string; kind: string; message: string }

export const RUN_COLOR: Record<RunStatus, string> = {
  Queued: 'gray', Running: 'blue', Succeeded: 'green', Failed: 'red',
}

export const isActive = (r?: Run) => r?.status === 'Queued' || r?.status === 'Running'