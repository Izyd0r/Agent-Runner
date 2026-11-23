import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Tabs, Text, Title } from '@mantine/core'
import { api } from './api'
import Layout from './Layout'
import Board from './Board'
import AgentsTab from './AgentsTab'
import MembersTab from './MembersTab'
import type { Project } from './types'

export default function ProjectPage() {
  const { id } = useParams() as { id: string }
  const { data: project } = useQuery({ queryKey: ['project', id], queryFn: () => api<Project>(`/projects/${id}`) })

  return (
    <Layout>
      <Title order={2}>{project?.name}</Title>
      <Text size="sm" c="dimmed" mb="md">{project?.gitHubUrl}</Text>
      <Tabs defaultValue="board">
        <Tabs.List mb="md">
          <Tabs.Tab value="board">Board</Tabs.Tab>
          <Tabs.Tab value="agents">Agents</Tabs.Tab>
          <Tabs.Tab value="members">Members</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="board"><Board projectId={id} /></Tabs.Panel>
        <Tabs.Panel value="agents"><AgentsTab projectId={id} /></Tabs.Panel>
        <Tabs.Panel value="members"><MembersTab projectId={id} /></Tabs.Panel>
      </Tabs>
    </Layout>
  )
}