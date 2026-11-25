import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { Badge, Button, Group, Loader, Menu, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core'
import { useDisclosure, usePrevious } from '@mantine/hooks'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import RunLogModal from './RunLogModal'
import { RUN_COLOR, STATUSES, isActive, type Agent, type Member, type Run, type Status, type Task } from './types'

export default function Board({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const base = `/projects/${projectId}`
  const [opened, { open, close }] = useDisclosure(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [logRunId, setLogRunId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const key = ['tasks', projectId]
  const runsKey = ['runs', projectId]

  // Runs: poll every 2s while anything is queued/running
  const { data: runs = [] } = useQuery({
    queryKey: runsKey,
    queryFn: () => api<Run[]>(`${base}/runs`),
    refetchInterval: q => (q.state.data?.some(isActive) ? 2000 : false),
  })
  const anyActive = runs.some(isActive)

  // Tasks: also poll while a run is active (the server moves the task to Review when it finishes)
  const { data: tasks = [] } = useQuery({
    queryKey: key,
    queryFn: () => api<Task[]>(`${base}/tasks`),
    refetchInterval: anyActive ? 2000 : false,
  })
  const { data: agents = [] } = useQuery({ queryKey: ['agents', projectId], queryFn: () => api<Agent[]>(`${base}/agents`) })
  const { data: members = [] } = useQuery({ queryKey: ['members', projectId], queryFn: () => api<Member[]>(`${base}/members`) })

  // When the last active run finishes, refresh tasks once more
  const wasActive = usePrevious(anyActive)
  useEffect(() => {
    if (wasActive && !anyActive) qc.invalidateQueries({ queryKey: key })
  }, [wasActive, anyActive]) // eslint-disable-line react-hooks/exhaustive-deps

  const onError = (e: unknown) => notifications.show({ color: 'red', message: (e as Error).message })

  const form = useForm({
    initialValues: { title: '', description: '', assignee: '' },
    validate: { title: v => (v.trim() ? null : 'Required') },
  })

  const openCreate = () => {
    setEditing(null)
    form.reset()
    open()
  }

  const openEdit = (t: Task) => {
    setEditing(t)
    form.setValues({
      title: t.title,
      description: t.description ?? '',
      assignee: t.assigneeAgentId ? `a:${t.assigneeAgentId}` : t.assigneeUserId ? `u:${t.assigneeUserId}` : '',
    })
    form.resetDirty()
    open()
  }

  const closeForm = () => {
    close()
    setEditing(null)
    form.reset()
  }

  const save = useMutation({
    mutationFn: (v: typeof form.values) => {
      const body = JSON.stringify({
        title: v.title.trim(),
        description: v.description.trim() || null,
        assigneeUserId: v.assignee.startsWith('u:') ? v.assignee.slice(2) : null,
        assigneeAgentId: v.assignee.startsWith('a:') ? v.assignee.slice(2) : null,
      })
      return editing
        ? api(`${base}/tasks/${editing.id}`, { method: 'PUT', body })
        : api(`${base}/tasks`, { method: 'POST', body })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); closeForm() },
    onError,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError,
  })

  const startRun = useMutation({
    mutationFn: (taskId: string) => api<Run>(`${base}/tasks/${taskId}/run`, { method: 'POST' }),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: runsKey })
      qc.invalidateQueries({ queryKey: key })
      setLogRunId(r.id) // open the live log right away
    },
    onError,
  })

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return
    const status = e.over.id as Status
    const task = tasks.find(t => t.id === e.active.id)
    if (!task || task.status === status) return
    const maxPos = Math.max(0, ...tasks.filter(t => t.status === status).map(t => t.position))
    move.mutate({ id: task.id, status, position: maxPos + 1 })
  }

  const assigneeLabel = (t: Task) =>
    t.assigneeAgentId ? `${agents.find(a => a.id === t.assigneeAgentId)?.name ?? 'agent'}`
    : t.assigneeUserId ? members.find(m => m.userId === t.assigneeUserId)?.email ?? 'user'
    : null

  const assigneeData = [
    { group: 'People', items: members.map(m => ({ value: `u:${m.userId}`, label: m.email })) },
    { group: 'Agents', items: agents.map(a => ({ value: `a:${a.id}`, label: `${a.name}` })) },
  ]

  // Runs come newest-first from the server
  const taskRuns = (taskId: string) => runs.filter(r => r.taskId === taskId)
  const selectedRun = runs.find(r => r.id === logRunId)
  const modalTaskRuns = selectedRun ? taskRuns(selectedRun.taskId) : []

  return (
    <>
      <Group justify="flex-end" mb="md"><Button onClick={openCreate}>New task</Button></Group>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SimpleGrid cols={{ base: 1, md: 4 }}>
          {STATUSES.map(s => (
            <Column key={s} status={s}>
              {tasks.filter(t => t.status === s).sort((a, b) => a.position - b.position).map(t => {
                const tRuns = taskRuns(t.id)
                const latest = tRuns[0]
                return (
                  <Card
                    key={t.id}
                    task={t}
                    assignee={assigneeLabel(t)}
                    run={latest}
                    attemptCount={tRuns.length}
                    starting={startRun.isPending && startRun.variables === t.id}
                    onEdit={() => openEdit(t)}
                    onDelete={() => remove.mutate(t.id)}
                    onRun={() => startRun.mutate(t.id)}
                    onLogs={() => setLogRunId(latest?.id ?? null)}
                  />
                )
              })}
            </Column>
          ))}
        </SimpleGrid>
      </DndContext>

      <Modal opened={opened} onClose={closeForm} title={editing ? 'Edit task' : 'New task'}>
        <form onSubmit={form.onSubmit(v => save.mutate(v))}>
          <Stack>
            <TextInput label="Title" data-autofocus {...form.getInputProps('title')} />
            <Textarea label="Description" autosize minRows={3} {...form.getInputProps('description')} />
            <Select label="Assignee" data={assigneeData} clearable placeholder="Unassigned"
              {...form.getInputProps('assignee')} onChange={v => form.setFieldValue('assignee', v ?? '')} />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeForm}>Cancel</Button>
              <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Create'}</Button>
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

function Column({ status, children }: { status: Status; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <Paper ref={setNodeRef} withBorder p="sm" mih={300}
      style={{ outline: isOver ? '2px solid var(--mantine-color-teal-6)' : undefined }}>
      <Title order={5} mb="sm">{status}</Title>
      <Stack gap="xs">{children}</Stack>
    </Paper>
  )
}

function Card({ task, assignee, run, attemptCount, starting, onEdit, onDelete, onRun, onLogs }: {
  task: Task
  assignee: string | null
  run?: Run
  attemptCount: number
  starting: boolean
  onEdit: () => void
  onDelete: () => void
  onRun: () => void
  onLogs: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  return (
    <Paper ref={setNodeRef} withBorder p="xs" {...listeners} {...attributes}
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        opacity: isDragging ? 0.6 : 1, cursor: 'grab', touchAction: 'none',
      }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text size="sm" fw={500}>{task.title}</Text>
        <div onPointerDown={e => e.stopPropagation()}>
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <Button variant="subtle" color="gray" size="compact-xs" aria-label={`Actions for ${task.title}`}>⋯</Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item onClick={onEdit}>Edit task</Menu.Item>
              <Menu.Item color="red" onClick={onDelete}>Delete task</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      </Group>
      {task.description && <Text size="xs" c="dimmed" lineClamp={2}>{task.description}</Text>}
      {assignee && <Badge mt="xs" size="xs" variant="light">{assignee}</Badge>}

      {/* Run controls: only for agent-assigned tasks. Stop pointerdown so clicks don't start a drag. */}
      {task.assigneeAgentId && (
        <Group mt="xs" gap="xs" onPointerDown={e => e.stopPropagation()}>
          {run && (
            <Badge
              size="xs"
              variant="light"
              color={RUN_COLOR[run.status]}
              style={{ cursor: 'pointer' }}
              onClick={onLogs}
              leftSection={isActive(run) ? <Loader size={8} /> : undefined}
            >
              {attemptCount > 1 ? `#${attemptCount} · ` : ''}{run.status}
            </Badge>
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
          <Button size="compact-xs" variant="light" disabled={isActive(run)} loading={starting} onClick={onRun}>
            {run ? 'Re-run' : 'Run'}
          </Button>
        </Group>
      )}
    </Paper>
  )
}