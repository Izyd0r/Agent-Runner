import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AppShell, Badge, Button, Container, Group, Text, Title, Tooltip } from '@mantine/core'
import { api, getExpiresAt, logout, refreshSession } from './api'

const ONE_HOUR_MS = 60 * 60 * 1000

function formatRemaining(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api<{ email: string }>('/me') })

  const [expiresAt, setExpiresAt] = useState<number | null>(() => getExpiresAt())
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const sync = () => {
      setExpiresAt(getExpiresAt())
      setNow(Date.now())
    }
    window.addEventListener('auth-changed', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('auth-changed', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      const current = Date.now()
      setNow(current)
      const exp = getExpiresAt()
      if (exp && current >= exp) {
        logout()
        qc.clear()
        nav('/auth')
      }
    }, 1000)
    return () => clearInterval(id)
  }, [nav, qc])

  useEffect(() => {
    const onActivity = () => {
      if (!getExpiresAt()) return
      setExpiresAt(Date.now() + ONE_HOUR_MS)
      setNow(Date.now())
      void refreshSession(15_000)
    }
    window.addEventListener('pointerdown', onActivity, { passive: true })
    return () => window.removeEventListener('pointerdown', onActivity)
  }, [])

  const remainingMs = expiresAt ? Math.max(0, expiresAt - now) : ONE_HOUR_MS
  const badgeColor = remainingMs <= 60_000 ? 'red' : remainingMs <= 5 * 60_000 ? 'yellow' : 'teal'

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4} component={Link} to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            AgentHub
          </Title>
          <Group>
            {expiresAt && (
              <Tooltip label="Session time left (click anywhere to reset to 60:00)">
                <Badge
                  variant="light"
                  color={badgeColor}
                  style={{ fontVariantNumeric: 'tabular-nums', cursor: 'pointer' }}
                  onClick={() => void refreshSession(0)}
                >
                  {formatRemaining(remainingMs)}
                </Badge>
              </Tooltip>
            )}
            <Text size="sm">{data?.email}</Text>
            <Button size="xs" variant="default" onClick={() => { logout(); qc.clear(); nav('/auth') }}>
              Log out
            </Button>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="xl">{children}</Container>
      </AppShell.Main>
    </AppShell>
  )
}