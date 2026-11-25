import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import {
  ActionIcon, Badge, Box, Button, Code, Divider, Drawer, Group, Loader, Menu,
  Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title, Tooltip,
} from '@mantine/core'
import { useDisclosure, usePrevious } from '@mantine/hooks'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import RunLogModal from './RunLogModal'
import { RUN_COLOR, STATUSES, isActive, type Agent, type Member, type Run, type Status, type Task } from './types'

const STATUS_COLOR: Record<Status, string> = {
  Todo: 'gray',
  InProgress: 'blue',
  Review: 'yellow',
  Done: 'teal',
}

const STATUS_LABEL: Record<Status, string> = {
  Todo: 'To Do',
  InProgress: 'In Progress',
  Review: 'In Review',
  Done: 'Done',
}

function formatDuration(startIso: string, endIso?: string | null): string {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const totalSec = Math.max(0, Math.round((end - start) / 1000))
  const mins = Math.floor(totalSec / 60)
  const secs = totalSec % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

export default function Board({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const base = `/projects/${projectId}`
  const [createOpened, { open: openCreate, close: closeCreate }] = useDisclosure(false)
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null)
  const [logRunId, setLogRunId] = useState<string | null>(null)

  // Inline editing state inside the Task Drawer
  const [editingField, setEditingField] = useState<'title' | 'description' | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDesc, setDraftDesc] = useState('')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const key = ['tasks', projectId]
  const runsKey = ['runs', projectId]

  const { data: runs = [] } = useQuery({
    queryKey: runsKey,
    queryFn: () => api<Run[]>(`${base}/runs`),
    refetchInterval: q => (q.state.data?.some(isActive) ? 2000 : false),
  })
  const anyActive = runs.some(isActive)

  const { data: tasks = [] } = useQuery({
    queryKey: key,
    queryFn: () => api<Task[]>(`${base}/tasks`),
    refetchInterval: anyActive ? 2000 : false,
  })
  const { data: agents = [] } = useQuery({ queryKey: ['agents', projectId], queryFn: () => api<Agent[]>(`${base}/agents`) })
  const { data: members = [] } = useQuery({ queryKey: ['members', projectId], queryFn: () => api<Member[]>(`${base}/members`) })

  const wasActive = usePrevious(anyActive)
  useEffect(() => {
    if (wasActive && !anyActive) qc.invalidateQueries({ queryKey: key })
  }, [wasActive, anyActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const onError = (e: unknown) => notifications.show({ color: 'red', message: (e as Error).message })

  const createForm = useForm({
    initialValues: { title: '', description: '', assignee: '' },
    validate: { title: v => (v.trim() ? null : 'Required') },
  })

  const create = useMutation({
    mutationFn: (v: typeof createForm.values) =>
      api(`${base}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: v.title.trim(),
          description: v.description.trim() || null,
          assigneeUserId: v.assignee.startsWith('u:') ? v.assignee.slice(2) : null,
          assigneeAgentId: v.assignee.startsWith('a:') ? v.assignee.slice(2) : null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key })
      createForm.reset()
      closeCreate()
    },
    onError,
  })

  const updateTask = useMutation({
    mutationFn: (v: { id: string; title: string; description: string | null; assigneeUserId: string | null; assigneeAgentId: string | null }) =>
      api(`${base}/tasks/${v.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: v.title,
          description: v.description,
          assigneeUserId: v.assigneeUserId,
          assigneeAgentId: v.assigneeAgentId,
        }),
      }),
    onMutate: async v => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Task[]>(key)
      qc.setQueryData<Task[]>(key, old =>
        old?.map(t => (t.id === v.id ? { ...t, title: v.title, description: v.description, assigneeUserId: v.assigneeUserId, assigneeAgentId: v.assigneeAgentId } : t))
      )
      return { prev }
    },
    onError: (e, _v, ctx) => { qc.setQueryData(key, ctx?.prev); onError(e) },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  const move = useMutation({
    mutationFn: (v: { id: string; status: Status; position: number }) =>
      api(`${base}/tasks/${v.id}/move`, { method: 'PATCH', body: JSON.stringify({ status: v.status, position: v.position }) }),
    onMutate: async v => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Task[]>(key)
      qc.setQueryData<Task[]>(key, old => old?.map(t => (t.id === v.id ? { ...t, status: v.status, position: v.position } : t)))
      return { prev }
    },
    onError: (e, _v, ctx) => { qc.setQueryData(key, ctx?.prev); onError(e) },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => {
      if (detailTaskId === id) setDetailTaskId(null)
      qc.invalidateQueries({ queryKey: key })
    },
    onError,
  })

  const startRun = useMutation({
    mutationFn: (taskId: string) => api<Run>(`${base}/tasks/${taskId}/run`, { method: 'POST' }),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: runsKey })
      qc.invalidateQueries({ queryKey: key })
      setLogRunId(r.id)
    },
    onError,
  })

  function changeTaskStatus(task: Task, status: Status) {
    if (task.status === status) return
    const maxPos = Math.max(0, ...tasks.filter(t => t.status === status).map(t => t.position))
    move.mutate({ id: task.id, status, position: maxPos + 1 })
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return
    const status = e.over.id as Status
    const task = tasks.find(t => t.id === e.active.id)
    if (!task) return
    changeTaskStatus(task, status)
  }

  const openTaskDrawer = (t: Task) => {
    setDetailTaskId(t.id)
    setEditingField(null)
  }

  const startEditTitle = (t: Task) => {
    setDraftTitle(t.title)
    setEditingField('title')
  }

  const commitTitle = (t: Task) => {
    setEditingField(null)
    const trimmed = draftTitle.trim()
    if (!trimmed || trimmed === t.title) return
    updateTask.mutate({
      id: t.id,
      title: trimmed,
      description: t.description ?? null,
      assigneeUserId: t.assigneeUserId ?? null,
      assigneeAgentId: t.assigneeAgentId ?? null,
    })
  }

  const startEditDescription = (t: Task) => {
    setDraftDesc(t.description ?? '')
    setEditingField('description')
  }

  const commitDescription = (t: Task) => {
    setEditingField(null)
    const normalized = draftDesc.trim() || null
    if (normalized === (t.description ?? null)) return
    updateTask.mutate({
      id: t.id,
      title: t.title,
      description: normalized,
      assigneeUserId: t.assigneeUserId ?? null,
      assigneeAgentId: t.assigneeAgentId ?? null,
    })
  }

  const changeAssignee = (t: Task, val: string | null) => {
    const v = val ?? ''
    updateTask.mutate({
      id: t.id,
      title: t.title,
      description: t.description ?? null,
      assigneeUserId: v.startsWith('u:') ? v.slice(2) : null,
      assigneeAgentId: v.startsWith('a:') ? v.slice(2) : null,
    })
  }

  const assigneeInfo = (t: Task) => {
    if (t.assigneeAgentId) {
      const ag = agents.find(a => a.id === t.assigneeAgentId)
      return { label: ag?.name ?? 'Agent', isAgent: true, model: ag?.model }
    }
    if (t.assigneeUserId) {
      const m = members.find(m => m.userId === t.assigneeUserId)
      return { label: m?.email ?? 'User', isAgent: false }
    }
    return null
  }

  const assigneeData = [
    { group: 'Agents', items: agents.map(a => ({ value: `a:${a.id}`, label: ` ${a.name} (${a.model})` })) },
    { group: 'People', items: members.map(m => ({ value: `u:${m.userId}`, label: m.email })) },
  ]

  const taskRuns = (taskId: string) => runs.filter(r => r.taskId === taskId)
  const selectedRun = runs.find(r => r.id === logRunId)
  const modalTaskRuns = selectedRun ? taskRuns(selectedRun.taskId) : []

  const detailTask = tasks.find(t => t.id === detailTaskId) ?? null
  const detailRuns = detailTask ? taskRuns(detailTask.id) : []
  const detailLatestRun = detailRuns[0]

  return (
    <>
      <Group justify="space-between" mb="md">
        <Text size="sm" c="dimmed">
          {tasks.length} {tasks.length === 1 ? 'task' : 'tasks'} · Click any card to inspect or edit inline
        </Text>
        <Button onClick={openCreate}>+ New task</Button>
      </Group>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md">
          {STATUSES.map(s => {
            const colTasks = tasks.filter(t => t.status === s).sort((a, b) => a.position - b.position)
            return (
              <Column key={s} status={s} count={colTasks.length}>
                {colTasks.map(t => {
                  const tRuns = taskRuns(t.id)
                  const latest = tRuns[0]
                  return (
                    <TaskCard
                      key={t.id}
                      task={t}
                      assignee={assigneeInfo(t)}
                      run={latest}
                      attemptCount={tRuns.length}
                      starting={startRun.isPending && startRun.variables === t.id}
                      onOpen={() => openTaskDrawer(t)}
                      onDelete={() => remove.mutate(t.id)}
                      onMoveStatus={next => changeTaskStatus(t, next)}
                      onRun={() => startRun.mutate(t.id)}
                      onLogs={() => setLogRunId(latest?.id ?? null)}
                    />
                  )
                })}
              </Column>
            )
          })}
        </SimpleGrid>
      </DndContext>

      {/* Click-to-edit Task Detail Drawer */}
      <Drawer
        opened={!!detailTask}
        onClose={() => { setDetailTaskId(null); setEditingField(null) }}
        position="right"
        size="lg"
        title={
          detailTask && (
            <Group gap="xs">
              <Badge color={STATUS_COLOR[detailTask.status]} variant="light">
                {STATUS_LABEL[detailTask.status]}
              </Badge>
              <Text size="xs" c="dimmed" ff="monospace">
                #{detailTask.id.slice(0, 8)}
              </Text>
            </Group>
          )
        }
      >
        {detailTask && (
          <Stack gap="md">
            {/* Click-to-edit Title */}
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              {editingField === 'title' ? (
                <TextInput
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.currentTarget.value)}
                  onBlur={() => commitTitle(detailTask)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitTitle(detailTask)
                    if (e.key === 'Escape') setEditingField(null)
                  }}
                  size="md"
                  fw={600}
                  style={{ flex: 1 }}
                  autoFocus
                />
              ) : (
                <Tooltip label="Click to edit title" openDelay={400}>
                  <Title
                    order={4}
                    onClick={() => startEditTitle(detailTask)}
                    style={{
                      flex: 1,
                      cursor: 'text',
                      padding: '4px 6px',
                      marginLeft: -6,
                      borderRadius: 4,
                    }}
                  >
                    {detailTask.title}
                  </Title>
                </Tooltip>
              )}

              <Button size="xs" variant="subtle" color="red" onClick={() => remove.mutate(detailTask.id)}>
                Delete
              </Button>
            </Group>

            {/* Inline Status & Assignee Pickers */}
            <SimpleGrid cols={2}>
              <Select
                label="Status"
                size="xs"
                data={STATUSES.map(st => ({ value: st, label: STATUS_LABEL[st] }))}
                value={detailTask.status}
                onChange={v => v && changeTaskStatus(detailTask, v as Status)}
                allowDeselect={false}
              />
              <Select
                label="Assignee"
                size="xs"
                data={assigneeData}
                clearable
                placeholder="Unassigned"
                value={
                  detailTask.assigneeAgentId
                    ? `a:${detailTask.assigneeAgentId}`
                    : detailTask.assigneeUserId
                      ? `u:${detailTask.assigneeUserId}`
                      : null
                }
                onChange={v => changeAssignee(detailTask, v)}
              />
            </SimpleGrid>

            {/* Click-to-edit Agent Prompt / Description */}
            <div>
              <Group justify="space-between" mb={4}>
                <Text size="xs" fw={600} c="dimmed">
                  {detailTask.assigneeAgentId ? 'Prompt / Task instructions' : 'Description / Prompt'}
                </Text>
                <Text size="11px" c="dimmed">
                  {editingField === 'description' ? 'Ctrl+Enter to save · Esc to cancel' : 'Click below to edit'}
                </Text>
              </Group>

              {editingField === 'description' ? (
                <Stack gap={6}>
                  <Textarea
                    value={draftDesc}
                    onChange={e => setDraftDesc(e.currentTarget.value)}
                    onKeyDown={e => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') commitDescription(detailTask)
                      if (e.key === 'Escape') setEditingField(null)
                    }}
                    placeholder="Describe what the agent should build or fix, including file paths or acceptance criteria..."
                    autosize
                    minRows={5}
                    styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 13 } }}
                    autoFocus
                  />
                  <Group justify="flex-end" gap="xs">
                    <Button size="compact-xs" variant="default" onClick={() => setEditingField(null)}>
                      Cancel
                    </Button>
                    <Button size="compact-xs" onClick={() => commitDescription(detailTask)}>
                      Save prompt
                    </Button>
                  </Group>
                </Stack>
              ) : (
                <Paper
                  withBorder
                  p="sm"
                  radius="sm"
                  onClick={() => startEditDescription(detailTask)}
                  style={{
                    cursor: 'text',
                    minHeight: 88,
                    backgroundColor: 'var(--mantine-color-dark-8)',
                  }}
                >
                  {detailTask.description ? (
                    <Text size="sm" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                      {detailTask.description}
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed" fs="italic">
                      Click to write instructions or a prompt for the agent…
                    </Text>
                  )}
                </Paper>
              )}
            </div>

            {detailTask.assigneeAgentId && (
              <>
                <Divider />
                <Group justify="space-between">
                  <Text size="sm" fw={600}>
                    Agent Execution ({detailRuns.length} {detailRuns.length === 1 ? 'attempt' : 'attempts'})
                  </Text>
                  <Button
                    size="xs"
                    color="teal"
                    disabled={isActive(detailLatestRun)}
                    loading={startRun.isPending && startRun.variables === detailTask.id}
                    onClick={() => startRun.mutate(detailTask.id)}
                  >
                    {detailRuns.length > 0 ? '↻ Re-run prompt' : '▶ Run prompt'}
                  </Button>
                </Group>

                {detailRuns.length === 0 ? (
                  <Text size="xs" c="dimmed">
                    No runs yet. Click &ldquo;Run prompt&rdquo; to dispatch the assigned agent.
                  </Text>
                ) : (
                  <Stack gap="xs">
                    {detailRuns.map((r, idx) => {
                      const attemptNum = detailRuns.length - idx
                      const agName = agents.find(a => a.id === r.agentId)?.name ?? 'Agent'
                      return (
                        <Paper key={r.id} withBorder p="xs" radius="sm">
                          <Group justify="space-between" wrap="nowrap">
                            <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                              <Group gap="xs">
                                <Text size="xs" fw={600}>Attempt #{attemptNum}</Text>
                                <Badge size="xs" color={RUN_COLOR[r.status]}>{r.status}</Badge>
                                <Text size="xs" c="dimmed">· {agName}</Text>
                                <Text size="xs" c="dimmed">· {formatDuration(r.startedAt, r.finishedAt)}</Text>
                              </Group>
                              {r.branch && (
                                <Code style={{ fontSize: 11, width: 'fit-content' }}>{r.branch}</Code>
                              )}
                            </Stack>
                            <Group gap="xs" wrap="nowrap">
                              {r.pullRequestUrl && (
                                <Button
                                  component="a"
                                  href={r.pullRequestUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  size="compact-xs"
                                  variant="light"
                                  color="teal"
                                >
                                  PR ↗
                                </Button>
                              )}
                              <Button size="compact-xs" variant="default" onClick={() => setLogRunId(r.id)}>
                                Logs
                              </Button>
                            </Group>
                          </Group>
                        </Paper>
                      )
                    })}
                  </Stack>
                )}
              </>
            )}
          </Stack>
        )}
      </Drawer>

      {/* Create Task Modal */}
      <Modal opened={createOpened} onClose={closeCreate} title="New task" size="md">
        <form onSubmit={createForm.onSubmit(v => create.mutate(v))}>
          <Stack>
            <TextInput label="Title" placeholder="e.g. Add password reset endpoint" data-autofocus {...createForm.getInputProps('title')} />
            <Textarea
              label="Prompt / Instructions"
              description="Sent directly to the assigned agent along with the task title."
              placeholder="Specify what to implement, relevant files, and how to verify..."
              autosize
              minRows={4}
              {...createForm.getInputProps('description')}
            />
            <Select label="Assignee" data={assigneeData} clearable placeholder="Unassigned"
              {...createForm.getInputProps('assignee')} onChange={v => createForm.setFieldValue('assignee', v ?? '')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeCreate}>Cancel</Button>
              <Button type="submit" loading={create.isPending}>Create task</Button>
            </Group>
          </Stack>
        </form>
      </Modal>

      <RunLogModal
        projectId={projectId}
        runId={logRunId}
        taskRuns={modalTaskRuns}
        agents={agents}
        onSelectRun={setLogRunId}
        onClose={() => setLogRunId(null)}
      />
    </>
  )
}

function Column({ status, count, children }: { status: Status; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <Paper
      ref={setNodeRef}
      withBorder
      p="sm"
      mih={420}
      radius="md"
      style={{
        backgroundColor: 'var(--mantine-color-dark-8)',
        outline: isOver ? '2px solid var(--mantine-color-teal-6)' : undefined,
        transition: 'outline 120ms ease',
      }}
    >
      <Group justify="space-between" mb="sm">
        <Group gap="xs">
          <Box
            w={8}
            h={8}
            style={{
              borderRadius: '50%',
              backgroundColor: `var(--mantine-color-${STATUS_COLOR[status]}-5)`,
            }}
          />
          <Title order={6} tt="uppercase" c="dimmed" style={{ letterSpacing: 0.5 }}>
            {STATUS_LABEL[status]}
          </Title>
        </Group>
        <Badge size="xs" variant="light" color={STATUS_COLOR[status]} circle>
          {count}
        </Badge>
      </Group>

      <Stack gap="xs">
        {children}
        {count === 0 && (
          <Paper
            p="md"
            radius="sm"
            style={{
              border: '1px dashed var(--mantine-color-dark-4)',
              backgroundColor: 'transparent',
            }}
          >
            <Text size="xs" c="dimmed" ta="center">
              Drop tasks here
            </Text>
          </Paper>
        )}
      </Stack>
    </Paper>
  )
}

function TaskCard({ task, assignee, run, attemptCount, starting, onOpen, onDelete, onMoveStatus, onRun, onLogs }: {
  task: Task
  assignee: { label: string; isAgent: boolean; model?: string } | null
  run?: Run
  attemptCount: number
  starting: boolean
  onOpen: () => void
  onDelete: () => void
  onMoveStatus: (status: Status) => void
  onRun: () => void
  onLogs: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })

  const active = isActive(run)
  const accentColor = run ? RUN_COLOR[run.status] : STATUS_COLOR[task.status]

  return (
    <Paper
      ref={setNodeRef}
      withBorder
      p="sm"
      radius="sm"
      onClick={onOpen}
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        opacity: isDragging ? 0.55 : 1,
        cursor: 'pointer',
        borderLeft: `3px solid var(--mantine-color-${accentColor}-6)`,
        backgroundColor: 'var(--mantine-color-dark-7)',
        transition: isDragging ? undefined : 'border-color 150ms ease, background-color 150ms ease',
      }}
    >
      <Stack gap={6}>
        {/* Header: Dedicated Drag Handle + Title + Overflow Menu */}
        <Group justify="space-between" wrap="nowrap" align="flex-start" gap={6}>
          <Group gap={6} wrap="nowrap" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
            <Tooltip label="Drag to move" openDelay={400}>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                aria-label="Drag task"
                {...listeners}
                {...attributes}
                onClick={e => e.stopPropagation()}
                style={{ cursor: 'grab', touchAction: 'none', marginTop: 2, flexShrink: 0 }}
              >
                ⋮⋮
              </ActionIcon>
            </Tooltip>
            <Text size="sm" fw={600} lineClamp={2} style={{ lineHeight: 1.35 }}>
              {task.title}
            </Text>
          </Group>

          <div onClick={e => e.stopPropagation()}>
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon size="xs" variant="subtle" color="gray" aria-label={`Actions for ${task.title}`}>
                  ⋯
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Move to</Menu.Label>
                {STATUSES.filter(s => s !== task.status).map(s => (
                  <Menu.Item key={s} onClick={() => onMoveStatus(s)}>
                    {STATUS_LABEL[s]}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item color="red" onClick={onDelete}>Delete task</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </div>
        </Group>

        {/* Prompt preview */}
        {task.description && (
          <Text size="xs" c="dimmed" lineClamp={2} pl={24}>
            {task.description}
          </Text>
        )}

        {/* Assignee & latest run status */}
        <Group justify="space-between" align="center" wrap="wrap" gap={6} pl={24} mt={2}>
          {assignee ? (
            <Badge size="xs" variant="light" color={assignee.isAgent ? 'violet' : 'blue'}>
              {assignee.isAgent ? ` ${assignee.label}` : assignee.label}
            </Badge>
          ) : (
            <Text size="xs" c="dimmed">Unassigned</Text>
          )}

          {run && (
            <Badge
              size="xs"
              variant="dot"
              color={RUN_COLOR[run.status]}
              style={{ cursor: 'pointer' }}
              onClick={e => { e.stopPropagation(); onLogs() }}
              leftSection={active ? <Loader size={8} /> : undefined}
            >
              {attemptCount > 1 ? `Try #${attemptCount} · ` : ''}{run.status}
            </Badge>
          )}
        </Group>

        {/* Agent action footer */}
        {task.assigneeAgentId && (
          <>
            <Divider my={2} />
            <Group justify="space-between" align="center" onClick={e => e.stopPropagation()}>
              <Group gap={4}>
                {run && (
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={onLogs}>
                    Logs
                  </Button>
                )}
                {run?.pullRequestUrl && (
                  <Button
                    component="a"
                    href={run.pullRequestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="compact-xs"
                    variant="subtle"
                    color="teal"
                  >
                    PR ↗
                  </Button>
                )}
              </Group>

              <Button
                size="compact-xs"
                variant={run ? 'light' : 'filled'}
                color={run ? 'blue' : 'teal'}
                disabled={active}
                loading={starting}
                onClick={onRun}
              >
                {active ? 'Running…' : run ? '↻ Re-run' : '▶ Run'}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  )
}