import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ActionIcon, Button, Card, Group, NumberInput, Stack, Text, TextInput, Textarea } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import type { Agent } from './types'

export default function AgentsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const base = `/projects/${projectId}/agents`
  const key = ['agents', projectId]
  const { data: agents = [] } = useQuery({ queryKey: key, queryFn: () => api<Agent[]>(base) })

  const form = useForm({
    initialValues: { name: '', model: 'llama3.1', systemPrompt: 'You are a careful software engineer.', temperature: 0.2 },
    validate: { name: v => (v.trim() ? null : 'Required') },
  })

  const create = useMutation({
    mutationFn: (v: typeof form.values) => api(base, { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); form.reset() },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api(`${base}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  return (
    <Group align="flex-start" grow>
      <Stack>
        {agents.map(a => (
          <Card key={a.id} withBorder>
            <Group justify="space-between">
              <Text fw={600}>{a.name}</Text>
              <ActionIcon variant="subtle" color="red" onClick={() => remove.mutate(a.id)}>✕</ActionIcon>
            </Group>
            <Text size="sm" c="dimmed">{a.model} · temp {a.temperature}</Text>
            <Text size="xs" lineClamp={3} mt="xs">{a.systemPrompt}</Text>
          </Card>
        ))}
        {agents.length === 0 && <Text c="dimmed">No agents yet.</Text>}
      </Stack>

      <Card withBorder>
        <form onSubmit={form.onSubmit(v => create.mutate(v))}>
          <Stack>
            <Text fw={600}>New agent</Text>
            <TextInput label="Name" {...form.getInputProps('name')} />
            <TextInput label="Ollama model" description="Must be pulled locally, e.g. qwen2.5-coder" {...form.getInputProps('model')} />
            <Textarea label="System prompt" autosize minRows={4} {...form.getInputProps('systemPrompt')} />
            <NumberInput label="Temperature" min={0} max={2} step={0.1} decimalScale={1} {...form.getInputProps('temperature')} />
            <Button type="submit" loading={create.isPending}>Create agent</Button>
          </Stack>
        </form>
      </Card>
    </Group>
  )
}