import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable, type SortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ActionIcon, Badge, Box, Button, Checkbox, Code, Divider, Drawer, Group, Loader, Menu,
  Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title, Tooltip,
} from '@mantine/core'
import { useDisclosure, usePrevious } from '@mantine/hooks'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import RunLogModal from './RunLogModal'
import { COLUMN_COLORS, RUN_COLOR, isActive, type Agent, type BoardColumn, type Member, type Run, type Task } from './types'

type AssigneeGroups = { group: string; items: { value: string; label: string }[] }[]
type NewTask = { title: string; description: string | null; assignee: string } // assignee: 'a:<id>' | 'u:<id>' | ''

const parseAssignee = (v: string) => ({
  assigneeUserId: v.startsWith('u:') ? v.slice(2) : null,
  assigneeAgentId: v.startsWith('a:') ? v.slice(2) : null,
})

// Columns only shuffle visually while a *column* is being dragged. Without this guard, dragging a task
// over the board would also make the columns shift to "make room" for it.
const columnStrategy: SortingStrategy = args =>
  args.activeIndex === -1 ? null : horizontalListSortingStrategy(args)

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
  const [editingColumn, setEditingColumn] = useState<BoardColumn | null>(null)

  // Inline editing state inside the Task Drawer
  const [editingField, setEditingField] = useState<'title' | 'description' | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftDesc, setDraftDesc] = useState('')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const key = ['tasks', projectId]
  const runsKey = ['runs', projectId]
  const colKey = ['columns', projectId]

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
  const { data: columns = [] } = useQuery({
    queryKey: colKey,
    queryFn: () => api<BoardColumn[]>(`${base}/columns`),
  })
  const sortedColumns = [...columns].sort((a, b) => a.position - b.position)
  const columnOf = (t: Task) => columns.find(c => c.id === t.columnId)

  const { data: agents = [] } = useQuery({ queryKey: ['agents', projectId], queryFn: () => api<Agent[]>(`${base}/agents`) })
  const { data: members = [] } = useQuery({ queryKey: ['members', projectId], queryFn: () => api<Member[]>(`${base}/members`) })

  const wasActive = usePrevious(anyActive)
  useEffect(() => {
    if (wasActive && !anyActive) qc.invalidateQueries({ queryKey: key })
  }, [wasActive, anyActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const onError = (e: unknown) => notifications.show({ color: 'red', message: (e as Error).message })

  const createForm = useForm({
    initialValues: { title: '', description: '', assignee: '', columnId: '' },
    validate: { title: v => (v.trim() ? null : 'Required') },
  })

  const create = useMutation({
    mutationFn: (v: typeof createForm.values) =>
      api(`${base}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: v.title.trim(),
          description: v.description.trim() || null,
          columnId: v.columnId || null,
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
    mutationFn: (v: { id: string; columnId: string; position: number }) =>
      api(`${base}/tasks/${v.id}/move`, { method: 'PATCH', body: JSON.stringify({ columnId: v.columnId, position: v.position }) }),
    onMutate: async v => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Task[]>(key)
      qc.setQueryData<Task[]>(key, old => old?.map(t => (t.id === v.id ? { ...t, columnId: v.columnId, position: v.position } : t)))
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

  const addColumn = useMutation({
    mutationFn: (name: string) =>
      api(`${base}/columns`, { method: 'POST', body: JSON.stringify({ name, color: 'gray' }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: colKey }),
    onError,
  })

  const updateColumn = useMutation({
    mutationFn: (c: BoardColumn) =>
      api(`${base}/columns/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: c.name, color: c.color, isReviewTarget: c.isReviewTarget }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: colKey })
      setEditingColumn(null)
    },
    onError,
  })

  const removeColumn = useMutation({
    mutationFn: (v: { id: string; moveTo: string }) =>
      api(`${base}/columns/${v.id}?moveTo=${v.moveTo}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: colKey })
      qc.invalidateQueries({ queryKey: key })
    },
    onError,
  })

  // Inline "+ Add task" at the bottom of a column: title, prompt and assignee; lands in that column.
  const [lastAssignee, setLastAssignee] = useState<string>(() => {
    try { return localStorage.getItem(`lastAssignee:${projectId}`) ?? '' } catch { return '' }
  })

  const quickAdd = useMutation({
    mutationFn: (v: NewTask & { columnId: string }) =>
      api(`${base}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: v.title,
          description: v.description,
          ...parseAssignee(v.assignee),
          columnId: v.columnId,
        }),
      }),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: key })
      setLastAssignee(v.assignee)
      try { localStorage.setItem(`lastAssignee:${projectId}`, v.assignee) } catch { /* ignore */ }
    },
    onError,
  })

  const reorderColumns = useMutation({
    mutationFn: (ids: string[]) =>
      api(`${base}/columns/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) }),
    onMutate: async ids => {
      await qc.cancelQueries({ queryKey: colKey })
      const prev = qc.getQueryData<BoardColumn[]>(colKey)
      qc.setQueryData<BoardColumn[]>(colKey, old =>
        old?.map(c => ({ ...c, position: ids.indexOf(c.id) + 1 })))
      return { prev }
    },
    onError: (e, _v, ctx) => { qc.setQueryData(colKey, ctx?.prev); onError(e) },
    onSettled: () => qc.invalidateQueries({ queryKey: colKey }),
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

  function moveTask(task: Task, columnId: string) {
    if (task.columnId === columnId) return
    const maxPos = Math.max(0, ...tasks.filter(t => t.columnId === columnId).map(t => t.position))
    move.mutate({ id: task.id, columnId, position: maxPos + 1 })
  }

  function moveColumnTo(id: string, toIndex: number) {
    const ids = sortedColumns.map(c => c.id)
    const from = ids.indexOf(id)
    if (from < 0 || toIndex < 0 || toIndex >= ids.length || from === toIndex) return
    reorderColumns.mutate(arrayMove(ids, from, toIndex))
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return

    if (e.active.data.current?.type === 'column') {
      moveColumnTo(e.active.id as string, sortedColumns.findIndex(c => c.id === e.over!.id))
      return
    }

    const task = tasks.find(t => t.id === e.active.id)
    if (!task) return
    moveTask(task, e.over.id as string)
  }

  function deleteColumn(col: BoardColumn) {
    const target = sortedColumns.find(c => c.id !== col.id)
    if (!target) {
      notifications.show({ color: 'red', message: 'A board needs at least one column.' })
      return
    }
    const n = tasks.filter(t => t.columnId === col.id).length
    if (n > 0 && !window.confirm(`Move ${n} task(s) to "${target.name}" and delete "${col.name}"?`)) return
    removeColumn.mutate({ id: col.id, moveTo: target.id })
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

  const defaultAssignee = assigneeData.some(g => g.items.some(i => i.value === lastAssignee)) ? lastAssignee : ''

  const taskRuns = (taskId: string) => runs.filter(r => r.taskId === taskId)
  const selectedRun = runs.find(r => r.id === logRunId)
  const modalTaskRuns = selectedRun ? taskRuns(selectedRun.taskId) : []

  const detailTask = tasks.find(t => t.id === detailTaskId) ?? null
  const detailColumn = detailTask ? columnOf(detailTask) : undefined
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
        <SortableContext items={sortedColumns.map(c => c.id)} strategy={columnStrategy}>
        <Group wrap="nowrap" align="flex-start" gap="md" style={{ overflowX: 'auto', paddingBottom: 12 }}>
          {sortedColumns.map((col, idx) => {
            const colTasks = tasks.filter(t => t.columnId === col.id).sort((a, b) => a.position - b.position)
            return (
              <ColumnView
                key={col.id}
                column={col}
                count={colTasks.length}
                onEdit={() => setEditingColumn(col)}
                onDelete={() => deleteColumn(col)}
                assigneeData={assigneeData}
                defaultAssignee={defaultAssignee}
                onAddTask={v => quickAdd.mutateAsync({ columnId: col.id, ...v })}
                onMoveLeft={idx > 0 ? () => moveColumnTo(col.id, idx - 1) : undefined}
                onMoveRight={idx < sortedColumns.length - 1 ? () => moveColumnTo(col.id, idx + 1) : undefined}
              >
                {colTasks.map(t => {
                  const tRuns = taskRuns(t.id)
                  const latest = tRuns[0]
                  return (
                    <TaskCard
                      key={t.id}
                      task={t}
                      column={col}
                      columns={sortedColumns}
                      assignee={assigneeInfo(t)}
                      run={latest}
                      attemptCount={tRuns.length}
                      starting={startRun.isPending && startRun.variables === t.id}
                      onOpen={() => openTaskDrawer(t)}
                      onDelete={() => remove.mutate(t.id)}
                      onMoveColumn={id => moveTask(t, id)}
                      onRun={() => startRun.mutate(t.id)}
                      onLogs={() => setLogRunId(latest?.id ?? null)}
                    />
                  )
                })}
              </ColumnView>
            )
          })}
          <AddColumn onAdd={name => addColumn.mutate(name)} loading={addColumn.isPending} />
        </Group>
        </SortableContext>
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
              <Badge color={detailColumn?.color ?? 'gray'} variant="light">
                {detailColumn?.name ?? '—'}
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

            {/* Inline Column & Assignee Pickers */}
            <SimpleGrid cols={2}>
              <Select
                label="Column"
                size="xs"
                data={sortedColumns.map(c => ({ value: c.id, label: c.name }))}
                value={detailTask.columnId}
                onChange={v => v && moveTask(detailTask, v)}
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
            <Select
              label="Column"
              placeholder={sortedColumns[0]?.name}
              data={sortedColumns.map(c => ({ value: c.id, label: c.name }))}
              clearable
              {...createForm.getInputProps('columnId')}
              onChange={v => createForm.setFieldValue('columnId', v ?? '')}
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

      <Modal opened={!!editingColumn} onClose={() => setEditingColumn(null)} title="Edit column">
        {editingColumn && (
          <Stack>
            <TextInput
              label="Name"
              data-autofocus
              value={editingColumn.name}
              onChange={e => setEditingColumn({ ...editingColumn, name: e.currentTarget.value })}
            />
            <Select
              label="Color"
              data={COLUMN_COLORS}
              value={editingColumn.color}
              allowDeselect={false}
              onChange={v => v && setEditingColumn({ ...editingColumn, color: v })}
            />
            <Checkbox
              label="Move tasks here when an agent run succeeds"
              checked={editingColumn.isReviewTarget}
              onChange={e => setEditingColumn({ ...editingColumn, isReviewTarget: e.currentTarget.checked })}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setEditingColumn(null)}>Cancel</Button>
              <Button
                loading={updateColumn.isPending}
                disabled={!editingColumn.name.trim()}
                onClick={() => updateColumn.mutate({ ...editingColumn, name: editingColumn.name.trim() })}
              >
                Save
              </Button>
            </Group>
          </Stack>
        )}
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

function ColumnView({ column, count, onEdit, onDelete, onAddTask, assigneeData, defaultAssignee, onMoveLeft, onMoveRight, children }: {
  column: BoardColumn
  count: number
  onEdit: () => void
  onDelete: () => void
  onAddTask: (v: NewTask) => Promise<unknown>
  assigneeData: AssigneeGroups
  defaultAssignee: string
  onMoveLeft?: () => void
  onMoveRight?: () => void
  children: React.ReactNode
}) {
  // Sortable = draggable (to reorder columns, via the header handle) + droppable (tasks land on it).
  const {
    attributes, listeners, setNodeRef, setActivatorNodeRef,
    transform, transition, isDragging, isOver, active,
  } = useSortable({ id: column.id, data: { type: 'column' } })
  const taskIsOver = isOver && active?.data.current?.type === 'task'

  return (
    <Paper
      ref={setNodeRef}
      withBorder
      p="sm"
      mih={420}
      w={300}
      miw={300}
      radius="md"
      style={{
        flexShrink: 0,
        backgroundColor: 'var(--mantine-color-dark-8)',
        outline: taskIsOver ? '2px solid var(--mantine-color-teal-6)' : undefined,
        transform: CSS.Translate.toString(transform),
        transition: transition ?? 'outline 120ms ease',
        opacity: isDragging ? 0.6 : 1,
        zIndex: isDragging ? 10 : undefined,
        position: 'relative',
      }}
    >
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Tooltip label="Drag to reorder column" openDelay={400}>
            <ActionIcon
              ref={setActivatorNodeRef}
              size="xs"
              variant="subtle"
              color="gray"
              aria-label={`Drag column ${column.name}`}
              {...attributes}
              {...listeners}
              style={{ cursor: 'grab', touchAction: 'none', flexShrink: 0 }}
            >
              ⋮⋮
            </ActionIcon>
          </Tooltip>
          <Box
            w={8}
            h={8}
            style={{
              borderRadius: '50%',
              flexShrink: 0,
              backgroundColor: `var(--mantine-color-${column.color}-5)`,
            }}
          />
          <Title order={6} tt="uppercase" c="dimmed" lineClamp={1} style={{ letterSpacing: 0.5 }}>
            {column.name}
          </Title>
          {column.isReviewTarget && (
            <Tooltip label="Successful agent runs land here">
              <Badge size="xs" variant="outline" color="gray">PR</Badge>
            </Tooltip>
          )}
        </Group>
        <Group gap={6} wrap="nowrap">
          <Badge size="xs" variant="light" color={column.color} circle>
            {count}
          </Badge>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon size="xs" variant="subtle" color="gray" aria-label={`Actions for column ${column.name}`}>
                ⋯
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={onEdit}>Edit column</Menu.Item>
              <Menu.Item disabled={!onMoveLeft} onClick={onMoveLeft}>Move left</Menu.Item>
              <Menu.Item disabled={!onMoveRight} onClick={onMoveRight}>Move right</Menu.Item>
              <Menu.Divider />
              <Menu.Item color="red" onClick={onDelete}>Delete column</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
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

      <AddTask onAdd={onAddTask} assigneeData={assigneeData} defaultAssignee={defaultAssignee} />
    </Paper>
  )
}

function AddTask({ onAdd, assigneeData, defaultAssignee }: {
  onAdd: (v: NewTask) => Promise<unknown>
  assigneeData: AssigneeGroups
  defaultAssignee: string
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assignee, setAssignee] = useState('')
  const [busy, setBusy] = useState(false)

  const openForm = () => { setAssignee(defaultAssignee); setOpen(true) }
  const close = () => { setOpen(false); setTitle(''); setDescription('') }

  const submit = async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await onAdd({ title: t, description: description.trim() || null, assignee })
      // stay open for the next task; keep the assignee, clear the text
      setTitle('')
      setDescription('')
    } catch {
      // the mutation's onError already shows a toast; keep everything so nothing is lost
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="subtle" color="gray" size="compact-sm" fullWidth justify="flex-start" mt="xs" onClick={openForm}>
        + Add task
      </Button>
    )
  }

  return (
    <Stack gap={6} mt="xs">
      <TextInput
        autoFocus
        size="xs"
        placeholder="Task title…"
        value={title}
        onChange={e => setTitle(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter') { e.preventDefault(); void submit() }
          if (e.key === 'Escape') close()
        }}
      />
      <Textarea
        size="xs"
        autosize
        minRows={2}
        maxRows={8}
        placeholder="Prompt / instructions (optional)"
        value={description}
        onChange={e => setDescription(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void submit() }
          if (e.key === 'Escape') close()
        }}
      />
      <Select
        size="xs"
        data={assigneeData}
        clearable
        placeholder="Unassigned"
        value={assignee || null}
        onChange={v => setAssignee(v ?? '')}
      />
      <Group gap="xs" justify="space-between">
        <Group gap="xs">
          <Button size="compact-xs" onClick={() => void submit()} loading={busy} disabled={!title.trim()}>
            Add task
          </Button>
          <Button size="compact-xs" variant="default" onClick={close}>Cancel</Button>
        </Group>
        <Text size="10px" c="dimmed">Enter in title · Ctrl+Enter in prompt</Text>
      </Group>
    </Stack>
  )
}

function AddColumn({ onAdd, loading }: { onAdd: (name: string) => void; loading: boolean }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')

  const submit = () => {
    if (name.trim()) onAdd(name.trim())
    setName('')
    setAdding(false)
  }

  if (!adding) {
    return (
      <Button variant="default" w={300} miw={300} loading={loading} onClick={() => setAdding(true)} style={{ flexShrink: 0 }}>
        + Add column
      </Button>
    )
  }
  return (
    <Paper withBorder p="sm" radius="md" w={300} miw={300} style={{ flexShrink: 0 }}>
      <TextInput
        autoFocus
        placeholder="Column name"
        value={name}
        onChange={e => setName(e.currentTarget.value)}
        onBlur={submit}
        onKeyDown={e => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') { setName(''); setAdding(false) }
        }}
      />
    </Paper>
  )
}

function TaskCard({ task, column, columns, assignee, run, attemptCount, starting, onOpen, onDelete, onMoveColumn, onRun, onLogs }: {
  task: Task
  column?: BoardColumn
  columns: BoardColumn[]
  assignee: { label: string; isAgent: boolean; model?: string } | null
  run?: Run
  attemptCount: number
  starting: boolean
  onOpen: () => void
  onDelete: () => void
  onMoveColumn: (columnId: string) => void
  onRun: () => void
  onLogs: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id, data: { type: 'task' } })

  const active = isActive(run)
  const accentColor = run ? RUN_COLOR[run.status] : column?.color ?? 'gray'

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
                {columns.filter(c => c.id !== task.columnId).map(c => (
                  <Menu.Item key={c.id} onClick={() => onMoveColumn(c.id)}>
                    {c.name}
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