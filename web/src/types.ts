export type Status = 'Todo' | 'InProgress' | 'Review' | 'Done'
export const STATUSES: Status[] = ['Todo', 'InProgress', 'Review', 'Done']

export interface Project { id: string; name: string; description?: string; gitHubUrl?: string }
export interface Task {
  id: string; title: string; description?: string; status: Status; position: number
  assigneeUserId?: string | null; assigneeAgentId?: string | null
}
export interface Agent { id: string; name: string; model: string; systemPrompt: string; temperature: number }
export interface Member { userId: string; email: string; role: 'Owner' | 'Member' }