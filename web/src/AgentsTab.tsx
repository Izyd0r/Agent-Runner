import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ActionIcon, Badge, Button, Card, Group, Loader, Menu, Modal, NumberInput,
  Paper, Select, Stack, Table, Text, TextInput, Textarea, Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import RunLogModal from './RunLogModal'
import { RUN_COLOR, isActive, type Agent, type Run } from './types'

type AgentRunSummary = Run & { taskTitle: string; logCount: number }

interface OllamaModel {
  name: string
  sizeBytes: number
  parameterSize?: string | null
  quantization?: string | null
}

interface ModelsResponse {
  available: boolean
  error?: string
  models: OllamaModel[]
}

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  const gb = bytes / (1024 ** 3)
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(bytes / (1024 ** 2))} MB`
}

function formatDuration(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const totalSec = Math.max(0, Math.round((end - start) / 1000))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

export default function AgentsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const base = `/projects/${projectId}/agents`
  const key = ['agents', projectId]
  const { data: agents = [] } = useQuery({ queryKey: key, queryFn: () => api<Agent[]>(base) })

  const {
    data: modelData,
    isFetching: loadingModels,
    refetch: refetchModels,
  } = useQuery({
    queryKey: ['ollama-models', projectId],
    queryFn: () => api<ModelsResponse>(`${base}/models`),
    staleTime: 30_000,
  })

  const [editOpened, editModal] = useDisclosure(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [logRunId, setLogRunId] = useState<string | null>(null)

  const { data: agentRuns = [], isLoading: loadingRuns } = useQuery({
    queryKey: ['agent-runs', projectId, selectedAgent?.id],
    enabled: !!selectedAgent,
    queryFn: () => api<AgentRunSummary[]>(`${base}/${selectedAgent!.id}/runs`),
    refetchInterval: q => (q.state.data?.some(isActive) ? 2000 : false),
  })

  const createForm = useForm({
    initialValues: { name: '', model: '', systemPrompt: 'You are a careful software engineer.', temperature: 0.2 },
    validate: {
      name: v => (v.trim() ? null : 'Required'),
      model: v => (v.trim() ? null : 'Select or enter a model'),
    },
  })

  // Auto-select the first available model when the list loads if none is chosen yet
  useEffect(() => {
    if (!createForm.values.model && modelData?.models.length) {
      createForm.setFieldValue('model', modelData.models[0].name)
    }
  }, [modelData]) // eslint-disable-line react-hooks/exhaustive-deps

  const editForm = useForm({
    initialValues: { name: '', model: '', systemPrompt: '', temperature: 0.2 },
    validate: {
      name: v => (v.trim() ? null : 'Required'),
      model: v => (v.trim() ? null : 'Required'),
    },
  })

  const openEdit = (a: Agent) => {
    setEditing(a)
    editForm.setValues({
      name: a.name,
      model: a.model,
      systemPrompt: a.systemPrompt,
      temperature: a.temperature,
    })
    editForm.resetDirty()
    editModal.open()
  }

  const closeEdit = () => {
    editModal.close()
    setEditing(null)
    editForm.reset()
  }

  const create = useMutation({
    mutationFn: (v: typeof createForm.values) => api(base, { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      createForm.reset()
      if (modelData?.models.length) createForm.setFieldValue('model', modelData.models[0].name)
    },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  const update = useMutation({
    mutationFn: (v: typeof editForm.values) =>
      api(`${base}/${editing!.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: v.name.trim(),
          model: v.model.trim(),
          systemPrompt: v.systemPrompt,
          temperature: v.temperature,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      closeEdit()
    },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  const buildSelectOptions = (currentValue?: string) => {
    const items = (modelData?.models ?? []).map(m => {
      const meta = [m.parameterSize, formatBytes(m.sizeBytes)].filter(Boolean).join(' · ')
      return {
        value: m.name,
        label: meta ? `${m.name} (${meta})` : m.name,
      }
    })
    // Keep existing value selectable even if the model was later removed from Ollama
    if (currentValue && !items.some(i => i.value === currentValue)) {
      items.unshift({ value: currentValue, label: `${currentValue} (not found locally)` })
    }
    return items
  }

  const renderModelField = (form: typeof createForm, currentValue?: string) => {
    const options = buildSelectOptions(currentValue)
    const hasModels = options.length > 0

    return (
      <div>
        <Group justify="space-between" mb={4}>
          <Text size="sm" fw={500}>Ollama model</Text>
          <Group gap={6}>
            {modelData && (
              <Badge size="xs" variant="dot" color={modelData.available ? 'teal' : 'red'}>
                {modelData.available ? `${modelData.models.length} local` : 'Ollama offline'}
              </Badge>
            )}
            <Tooltip label="Refresh local models">
              <ActionIcon size="xs" variant="subtle" onClick={() => refetchModels()} loading={loadingModels}>
                ↻
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {hasModels ? (
          <Select
            placeholder="Pick an installed Ollama model"
            searchable
            data={options}
            nothingFoundMessage="No matching local model"
            {...form.getInputProps('model')}
          />
        ) : (
          <TextInput
            placeholder="e.g. gpt-oss:20b"
            description={
              modelData?.available
                ? 'No models pulled yet. Run `ollama pull <model>` or enter a name manually.'
                : 'Could not reach Ollama. Enter a model name manually or click ↻ to retry.'
            }
            {...form.getInputProps('model')}
          />
        )}
      </div>
    )
  }

  const selectedRun = agentRuns.find(r => r.id === logRunId)
  const taskRuns = selectedRun ? agentRuns.filter(r => r.taskId === selectedRun.taskId) : []

  return (
    <>
      <Group align="flex-start" grow>
        <Stack>
          {agents.map(a => (
            <Card key={a.id} withBorder>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={600}>{a.name}</Text>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <Button variant="subtle" color="gray" size="compact-xs" aria-label={`Actions for ${a.name}`}>⋯</Button>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item onClick={() => openEdit(a)}>Edit agent</Menu.Item>
                    <Menu.Item color="red" onClick={() => remove.mutate(a.id)}>Delete agent</Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
              <Text size="sm" c="dimmed">{a.model} · temp {a.temperature}</Text>
              <Text size="xs" lineClamp={3} mt="xs">{a.systemPrompt}</Text>
              <Group mt="sm" gap="xs">
                <Button size="compact-xs" variant="light" onClick={() => setSelectedAgent(a)}>
                  Runs & logs
                </Button>
                <Button size="compact-xs" variant="default" onClick={() => openEdit(a)}>
                  Edit
                </Button>
              </Group>
            </Card>
          ))}
          {agents.length === 0 && <Text c="dimmed">No agents yet.</Text>}
        </Stack>

        <Card withBorder>
          <form onSubmit={createForm.onSubmit(v => create.mutate(v))}>
            <Stack>
              <Text fw={600}>New agent</Text>
              <TextInput label="Name" placeholder="e.g. Backend Engineer" {...createForm.getInputProps('name')} />
              {renderModelField(createForm)}
              <Textarea label="System prompt" autosize minRows={4} {...createForm.getInputProps('systemPrompt')} />
              <NumberInput label="Temperature" min={0} max={2} step={0.1} decimalScale={1} {...createForm.getInputProps('temperature')} />
              <Button type="submit" loading={create.isPending}>Create agent</Button>
            </Stack>
          </form>
        </Card>
      </Group>

      <Modal opened={editOpened} onClose={closeEdit} title="Edit agent" size="lg">
        <form onSubmit={editForm.onSubmit(v => update.mutate(v))}>
          <Stack>
            <TextInput label="Name" data-autofocus {...editForm.getInputProps('name')} />
            {renderModelField(editForm, editing?.model)}
            <Textarea label="System prompt" autosize minRows={5} {...editForm.getInputProps('systemPrompt')} />
            <NumberInput label="Temperature" min={0} max={2} step={0.1} decimalScale={1} {...editForm.getInputProps('temperature')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeEdit}>Cancel</Button>
              <Button type="submit" loading={update.isPending}>Save changes</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      {/* Run history & RunLogModal unchanged below */}
      <Modal
        opened={!!selectedAgent}
        onClose={() => { setSelectedAgent(null); setLogRunId(null) }}
        size="xl"
        title={
          selectedAgent && (
            <Group gap="xs">
              <Text fw={600}>{selectedAgent.name} — Run history</Text>
              <Badge variant="light">{selectedAgent.model}</Badge>
              <Badge variant="light" color="gray">temp {selectedAgent.temperature}</Badge>
            </Group>
          )
        }
      >
        {selectedAgent && (
          <Stack gap="sm">
            <Paper withBorder p="xs" bg="var(--mantine-color-dark-8)">
              <Text size="xs" c="dimmed" mb={2}>System prompt</Text>
              <Text size="xs" style={{ whiteSpace: 'pre-wrap' }}>{selectedAgent.systemPrompt}</Text>
            </Paper>

            {loadingRuns ? (
              <Group justify="center" p="md"><Loader size="sm" /></Group>
            ) : agentRuns.length === 0 ? (
              <Text c="dimmed" size="sm">This agent hasn’t executed any runs yet.</Text>
            ) : (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Task</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Duration</Table.Th>
                    <Table.Th>Started</Table.Th>
                    <Table.Th>Logs</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {agentRuns.map(r => (
                    <Table.Tr key={r.id}>
                      <Table.Td>
                        <Text size="sm" fw={500}>{r.taskTitle}</Text>
                        {r.branch && <Text size="xs" ff="monospace" c="dimmed">{r.branch}</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Badge size="xs" color={RUN_COLOR[r.status]}>{r.status}</Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatDuration(r.startedAt, r.finishedAt)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c="dimmed">{new Date(r.startedAt).toLocaleString()}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">{r.logCount}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" justify="flex-end">
                          {r.pullRequestUrl && (
                            <Button
                              component="a"
                              href={r.pullRequestUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              size="compact-xs"
                              variant="subtle"
                              color="teal"
                            >
                              PR ↗
                            </Button>
                          )}
                          <Button size="compact-xs" variant="light" onClick={() => setLogRunId(r.id)}>
                            View logs
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        )}
      </Modal>

      <RunLogModal
        projectId={projectId}
        runId={logRunId}
        taskRuns={taskRuns}
        agents={agents}
        onSelectRun={setLogRunId}
        onClose={() => setLogRunId(null)}
      />
    </>
  )
}