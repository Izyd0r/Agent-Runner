import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AppShell, Avatar, Badge, Container, Divider, Group,
  Menu, Text, Title, Tooltip, UnstyledButton,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { api, getExpiresAt, logout, refreshSession } from './api'
import AccountModal, { type Me } from './AccountModal'

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
  const { data } = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') })

  const [accountOpen, accountModal] = useDisclosure(false)
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
  const isWarning = remainingMs <= 5 * 60_000
  const isCritical = remainingMs <= 60_000
  const label = data?.displayName || data?.email || ''

  const handleLogout = () => {
    logout()
    qc.clear()
    nav('/auth')
  }

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={4} component={Link} to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            AgentHub
          </Title>

          <Group gap="sm">
            {expiresAt && (
              <Tooltip label="Session expires in — click anywhere to extend">
                <Badge
                  size="sm"
                  radius="sm"
                  variant={isWarning ? 'light' : 'default'}
                  color={isCritical ? 'red' : isWarning ? 'yellow' : 'gray'}
                  style={{ fontVariantNumeric: 'tabular-nums', cursor: 'pointer', fontWeight: 500 }}
                  onClick={() => void refreshSession(0)}
                >
                  {formatRemaining(remainingMs)}
                </Badge>
              </Tooltip>
            )}

            <Divider orientation="vertical" my={14} />

            {data && (
              <Menu position="bottom-end" width={220} withinPortal>
                <Menu.Target>
                  <UnstyledButton
                    px={8}
                    py={4}
                    style={{
                      borderRadius: 'var(--mantine-radius-sm)',
                    }}
                  >
                    <Group gap={8} wrap="nowrap">
                      <Avatar size={26} radius="xl" color="teal" variant="light">
                        {label.slice(0, 2).toUpperCase()}
                      </Avatar>
                      <Text size="sm" fw={500} maw={180} truncate>
                        {label}
                      </Text>
                      <Text size="xs" c="dimmed">▾</Text>
                    </Group>
                  </UnstyledButton>
                </Menu.Target>

                <Menu.Dropdown>
                  <Menu.Label>
                    <Text size="xs" fw={600} c="bright" truncate>
                      {data.displayName || 'Account'}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {data.email}
                    </Text>
                  </Menu.Label>
                  <Menu.Divider />
                  <Menu.Item onClick={accountModal.open}>Account settings</Menu.Item>
                  <Menu.Item color="red" onClick={handleLogout}>Log out</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="xl">{children}</Container>
      </AppShell.Main>

      <AccountModal opened={accountOpen} onClose={accountModal.close} user={data} />
    </AppShell>
  )
}