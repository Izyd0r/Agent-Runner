export type Status = 'Todo' | 'InProgress' | 'Review' | 'Done'
export const STATUSES: Status[] = ['Todo', 'InProgress', 'Review', 'Done']

export interface Project {
  id: string
  name: string
  description?: string | null
  gitHubUrl?: string | null
  hasGitHubToken?: boolean
}
export interface Task {
  id: string; title: string; description?: string; status: Status; position: number
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