import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ActionIcon, Badge, Button, Group, Modal, Paper, Select, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import { STATUSES, type Agent, type Member, type Status, type Task } from './types'

export default function Board({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const base = `/projects/${projectId}`
  const [opened, { open, close }] = useDisclosure(false)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const { data: tasks = [] } = useQuery({ queryKey: ['tasks', projectId], queryFn: () => api<Task[]>(`${base}/tasks`) })
  const { data: agents = [] } = useQuery({ queryKey: ['agents', projectId], queryFn: () => api<Agent[]>(`${base}/agents`) })
  const { data: members = [] } = useQuery({ queryKey: ['members', projectId], queryFn: () => api<Member[]>(`${base}/members`) })

  const key = ['tasks', projectId]
  const onError = (e: unknown) => notifications.show({ color: 'red', message: (e as Error).message })

  const form = useForm({
    initialValues: { title: '', description: '', assignee: '' },
    validate: { title: v => (v.trim() ? null : 'Required') },
  })

  const create = useMutation({
    mutationFn: (v: typeof form.values) =>
      api(`${base}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: v.title,
          description: v.description || null,
          assigneeUserId: v.assignee.startsWith('u:') ? v.assignee.slice(2) : null,
          assigneeAgentId: v.assignee.startsWith('a:') ? v.assignee.slice(2) : null,
        }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); form.reset(); close() },
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

  return (
    <>
      <Group justify="flex-end" mb="md"><Button onClick={open}>New task</Button></Group>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <SimpleGrid cols={{ base: 1, md: 4 }}>
          {STATUSES.map(s => (
            <Column key={s} status={s}>
              {tasks.filter(t => t.status === s).sort((a, b) => a.position - b.position).map(t => (
                <Card key={t.id} task={t} assignee={assigneeLabel(t)} onDelete={() => remove.mutate(t.id)} />
              ))}
            </Column>
          ))}
        </SimpleGrid>
      </DndContext>

      <Modal opened={opened} onClose={close} title="New task">
        <form onSubmit={form.onSubmit(v => create.mutate(v))}>
          <Stack>
            <TextInput label="Title" {...form.getInputProps('title')} />
            <Textarea label="Description" autosize minRows={3} {...form.getInputProps('description')} />
            <Select label="Assignee" data={assigneeData} clearable placeholder="Unassigned"
              {...form.getInputProps('assignee')} onChange={v => form.setFieldValue('assignee', v ?? '')} />
            <Button type="submit" loading={create.isPending}>Create</Button>
          </Stack>
        </form>
      </Modal>
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

function Card({ task, assignee, onDelete }: { task: Task; assignee: string | null; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  return (
    <Paper ref={setNodeRef} withBorder p="xs" {...listeners} {...attributes}
      style={{
        transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined,
        opacity: isDragging ? 0.6 : 1, cursor: 'grab', touchAction: 'none',
      }}>
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Text size="sm" fw={500}>{task.title}</Text>
        <ActionIcon size="xs" variant="subtle" color="red"
          onPointerDown={e => e.stopPropagation()} onClick={onDelete}>✕</ActionIcon>
      </Group>
      {task.description && <Text size="xs" c="dimmed" lineClamp={2}>{task.description}</Text>}
      {assignee && <Badge mt="xs" size="xs" variant="light">{assignee}</Badge>}
    </Paper>
  )
}