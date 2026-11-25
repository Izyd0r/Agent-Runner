import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Code, Group, Loader, Modal, ScrollArea, Stack, Text } from '@mantine/core'
import { api } from './api'
import { RUN_COLOR, isActive, type Run, type RunLog } from './types'

const KIND_COLOR: Record<string, string> = {
  info: 'gray', tool_call: 'blue', tool_result: 'teal', message: 'green', error: 'red',
}

export default function RunLogModal({ projectId, runId, onClose }: {
  projectId: string
  runId: string | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const base = `/projects/${projectId}/runs/${runId}`
  const logsKey = ['run-logs', runId]
  const viewport = useRef<HTMLDivElement>(null)

  const { data: run } = useQuery({
    queryKey: ['run', runId],
    enabled: !!runId,
    queryFn: () => api<Run>(base),
    refetchInterval: q => (q.state.data && !isActive(q.state.data) ? false : 1500),
  })
  const active = !run || isActive(run)

  const { data: logs = [] } = useQuery({
    queryKey: logsKey,
    enabled: !!runId,
    // Append only new lines to what is already cached
    queryFn: async () => {
      const prev = qc.getQueryData<RunLog[]>(logsKey) ?? []
      const fresh = await api<RunLog[]>(`${base}/logs?after=${prev.at(-1)?.id ?? 0}`)
      return fresh.length ? [...prev, ...fresh] : prev
    },
    refetchInterval: active ? 1500 : false,
  })

  // One last fetch when the run finishes, so the final lines aren't missed
  useEffect(() => {
    if (runId && !active) qc.invalidateQueries({ queryKey: ['run-logs', runId] })
  }, [active, runId, qc])

  // Keep scrolled to the newest line
  useEffect(() => {
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight })
  }, [logs.length])

  return (
    <Modal
      opened={!!runId}
      onClose={onClose}
      size="xl"
      title={
        <Group gap="xs">
          <Text fw={600}>Run log</Text>
          {run && <Badge color={RUN_COLOR[run.status]}>{run.status}</Badge>}
          {active && <Loader size="xs" />}
        </Group>
      }
    >
      <ScrollArea h={480} viewportRef={viewport}>
        <Stack gap={6}>
          {logs.length === 0 && <Text c="dimmed" size="sm">Waiting for output…</Text>}
          {logs.map(l => (
            <Group key={l.id} align="flex-start" wrap="nowrap" gap="xs">
              <Badge size="xs" variant="light" color={KIND_COLOR[l.kind] ?? 'gray'} w={90} style={{ flexShrink: 0 }}>
                {l.kind}
              </Badge>
              <Code block style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {l.message}
              </Code>
            </Group>
          ))}
        </Stack>
      </ScrollArea>
    </Modal>
  )
}