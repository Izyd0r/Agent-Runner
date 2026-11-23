import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Group, Paper, Stack, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import type { Member } from './types'

export default function MembersTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const base = `/projects/${projectId}/members`
  const key = ['members', projectId]
  const { data: members = [] } = useQuery({ queryKey: key, queryFn: () => api<Member[]>(base) })

  const form = useForm({ initialValues: { email: '' }, validate: { email: v => (/^\S+@\S+$/.test(v) ? null : 'Invalid email') } })

  const invite = useMutation({
    mutationFn: (v: { email: string }) => api(base, { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); form.reset() },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  return (
    <Stack maw={500}>
      <form onSubmit={form.onSubmit(v => invite.mutate(v))}>
        <Group align="flex-end">
          <TextInput label="Invite by email" style={{ flex: 1 }} {...form.getInputProps('email')} />
          <Button type="submit" loading={invite.isPending}>Add</Button>
        </Group>
      </form>
      {members.map(m => (
        <Paper key={m.userId} withBorder p="xs">
          <Group justify="space-between">
            <Text size="sm">{m.email}</Text>
            <Badge variant="light">{m.role}</Badge>
          </Group>
        </Paper>
      ))}
    </Stack>
  )
}