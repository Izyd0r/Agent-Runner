import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Badge, Button, Code, CopyButton, Divider, Group, Loader, Modal, Paper, ScrollArea, Select, SimpleGrid, Stack, Text, Tooltip } from '@mantine/core'
import { api } from './api'
import { RUN_COLOR, isActive, type Agent, type Run, type RunLog } from './types'

const KIND_COLOR: Record<string, string> = {
  info: 'gray', tool_call: 'blue', tool_result: 'teal', message: 'green', error: 'red',
}

function formatDuration(startIso?: string, endIso?: string | null, nowMs = Date.now()): string {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : nowMs
  const totalSec = Math.max(0, Math.round((end - start) / 1000))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

export default function RunLogModal({ projectId, runId, taskRuns, agents, onSelectRun, onClose }: {
  projectId: string
  runId: string | null
  taskRuns: Run[]
  agents: Agent[]
  onSelectRun: (id: string) => void
  onClose: () => void
}) {
  const qc = useQueryClient()
  const base = `/projects/${projectId}/runs/${runId}`
  const logsKey = ['run-logs', runId]
  const viewport = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())

  const { data: run } = useQuery({
    queryKey: ['run', runId],
    enabled: !!runId,
    queryFn: () => api<Run>(base),
    refetchInterval: q => (q.state.data && !isActive(q.state.data) ? false : 1500),
  })
  const active = !run || isActive(run)

  useEffect(() => {
    if (!runId || !active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [runId, active])

  const { data: logs = [] } = useQuery({
    queryKey: logsKey,
    enabled: !!runId,
    queryFn: async () => {
      const prev = qc.getQueryData<RunLog[]>(logsKey) ?? []
      const fresh = await api<RunLog[]>(`${base}/logs?after=${prev.at(-1)?.id ?? 0}`)
      return fresh.length ? [...prev, ...fresh] : prev
    },
    refetchInterval: active ? 1500 : false,
  })

  useEffect(() => {
    if (runId && !active) qc.invalidateQueries({ queryKey: ['run-logs', runId] })
  }, [active, runId, qc])

  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight })
  }, [logs.length])

  const telemetry = useMemo(() => {
    let steps = 0
    let promptTokens = 0
    let generatedTokens = 0
    let toolCalls = 0
    for (const l of logs) {
      if (l.kind === 'tool_call') toolCalls++
      const m = l.message.match(/^step (\d+): ~(\d+)\/\d+ prompt tokens, (\d+) generated/)
      if (m) {
        steps = Math.max(steps, Number(m[1]))
        promptTokens += Number(m[2])
        generatedTokens += Number(m[3])
      }
    }
    return { steps, promptTokens, generatedTokens, toolCalls }
  }, [logs])

  const agent = agents.find(a => a.id === run?.agentId)

  const attemptOptions = taskRuns.map((r, idx) => {
    const attemptNum = taskRuns.length - idx
    const agentName = agents.find(a => a.id === r.agentId)?.name ?? 'Agent'
    return {
      value: r.id,
      label: `Attempt #${attemptNum} · ${agentName} (${r.status})`,
    }
  })

  const fullLogText = logs
    .map(l => `[${new Date(l.at).toLocaleTimeString()}] [${l.kind.toUpperCase()}] ${l.message}`)
    .join('\n')

  return (
    <Modal
      opened={!!runId}
      onClose={onClose}
      size="xl"
      title={
        <Group gap="xs">
          <Text fw={600}>Run log</Text>
          {attemptOptions.length > 1 && runId && (
            <Select
              size="xs"
              w={260}
              data={attemptOptions}
              value={runId}
              onChange={v => v && onSelectRun(v)}
              allowDeselect={false}
            />
          )}
          {run && <Badge color={RUN_COLOR[run.status]}>{run.status}</Badge>}
          {run?.pullRequestUrl && (
            <Button
              component="a"
              href={run.pullRequestUrl}
              target="_blank"
              rel="noopener noreferrer"
              size="compact-xs"
              variant="light"
              color="teal"
            >
              Open PR ↗
            </Button>
          )}
          {active && <Loader size="xs" />}
        </Group>
      }
    >
      <Stack gap="sm">
        {run && (
          <Paper withBorder p="sm" radius="sm">
            <Stack gap="xs">
              <Group justify="space-between" align="flex-start" wrap="wrap" gap="xs">
                <div>
                  <Text size="xs" c="dimmed">Agent</Text>
                  <Group gap={6}>
                    <Text size="sm" fw={600}>{agent?.name ?? 'Unknown agent'}</Text>
                    {agent && (
                      <>
                        <Badge size="xs" variant="light">{agent.model}</Badge>
                        <Badge size="xs" variant="light" color="gray">temp {agent.temperature}</Badge>
                      </>
                    )}
                  </Group>
                </div>

                {run.branch && (
                  <div>
                    <Text size="xs" c="dimmed">Branch</Text>
                    <Group gap={4} wrap="nowrap">
                      <Code>{run.branch}</Code>
                      <CopyButton value={run.branch}>
                        {({ copied, copy }) => (
                          <Tooltip label={copied ? 'Copied' : 'Copy branch'}>
                            <ActionIcon size="xs" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                              {copied ? '✓' : '⧉'}
                            </ActionIcon>
                          </Tooltip>
                        )}
                      </CopyButton>
                    </Group>
                  </div>
                )}
              </Group>

              <Divider />

              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
                <div>
                  <Text size="xs" c="dimmed">Duration</Text>
                  <Text size="sm" fw={600}>{formatDuration(run.startedAt, run.finishedAt, now)}</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Steps / Tool calls</Text>
                  <Text size="sm" fw={500}>{telemetry.steps} steps · {telemetry.toolCalls} tools</Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Tokens (Prompt / Gen)</Text>
                  <Text size="sm" fw={500}>
                    {telemetry.promptTokens.toLocaleString()} / {telemetry.generatedTokens.toLocaleString()}
                  </Text>
                </div>
                <div>
                  <Text size="xs" c="dimmed">Time window</Text>
                  <Text size="xs">
                    {new Date(run.startedAt).toLocaleTimeString()} –{' '}
                    {run.finishedAt ? new Date(run.finishedAt).toLocaleTimeString() : 'running…'}
                  </Text>
                </div>
              </SimpleGrid>
            </Stack>
          </Paper>
        )}

        <Group justify="space-between">
          <Text size="xs" c="dimmed">{logs.length} log entries</Text>
          {logs.length > 0 && (
            <CopyButton value={fullLogText}>
              {({ copied, copy }) => (
                <Button size="compact-xs" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                  {copied ? 'Copied all logs' : 'Copy all logs'}
                </Button>
              )}
            </CopyButton>
          )}
        </Group>

        <ScrollArea h={420} viewportRef={viewport}>
          <Stack gap={6}>
            {logs.length === 0 && <Text c="dimmed" size="sm">Waiting for output…</Text>}
            {logs.map(l => (
              <Group key={l.id} align="flex-start" wrap="nowrap" gap="xs">
                <Stack gap={2} w={95} style={{ flexShrink: 0 }}>
                  <Badge size="xs" variant="light" color={KIND_COLOR[l.kind] ?? 'gray'} fullWidth>
                    {l.kind}
                  </Badge>
                  <Text size="10px" c="dimmed" ta="center">
                    {new Date(l.at).toLocaleTimeString()}
                  </Text>
                </Stack>
                <Code block style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {l.message}
                </Code>
              </Group>
            ))}
          </Stack>
        </ScrollArea>
      </Stack>
    </Modal>
  )
}