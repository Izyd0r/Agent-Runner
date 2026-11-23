import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Group, Modal, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import Layout from './Layout'
import type { Project } from './types'

export default function Home() {
  const qc = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') })

  const form = useForm({
    initialValues: { name: '', description: '', gitHubUrl: '' },
    validate: { name: v => (v.trim() ? null : 'Required') },
  })

  const create = useMutation({
    mutationFn: (v: typeof form.values) => api('/projects', { method: 'POST', body: JSON.stringify(v) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); form.reset(); close() },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  return (
    <Layout>
      <Group justify="space-between" mb="md">
        <Title order={2}>Projects</Title>
        <Button onClick={open}>New project</Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        {projects.map(p => (
          <Card key={p.id} withBorder component={Link} to={`/projects/${p.id}`}>
            <Text fw={600}>{p.name}</Text>
            <Text size="sm" c="dimmed" lineClamp={2}>{p.description || 'No description'}</Text>
            {p.gitHubUrl && <Text size="xs" mt="xs" c="teal">{p.gitHubUrl}</Text>}
          </Card>
        ))}
      </SimpleGrid>
      {projects.length === 0 && <Text c="dimmed">No projects yet.</Text>}

      <Modal opened={opened} onClose={close} title="New project">
        <form onSubmit={form.onSubmit(v => create.mutate(v))}>
          <Stack>
            <TextInput label="Name" {...form.getInputProps('name')} />
            <Textarea label="Description" {...form.getInputProps('description')} />
            <TextInput label="GitHub URL" placeholder="https://github.com/user/repo" {...form.getInputProps('gitHubUrl')} />
            <Button type="submit" loading={create.isPending}>Create</Button>
          </Stack>
        </form>
      </Modal>
    </Layout>
  )
}