import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppShell, Button, Container, Group, Text, Title } from '@mantine/core'
import { api, logout } from './api'

export default function Home() {
  const nav = useNavigate()
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string }>('/me') })

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4}>Agent-Runner</Title>
          <Group>
            <Text size="sm">{data?.email}</Text>
            <Button size="xs" variant="default" onClick={() => { logout(); nav('/auth') }}>
              Log out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container>
          <Title order={2}>Projects</Title>
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}