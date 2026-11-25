import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Card, Checkbox, Group, Menu, Modal, PasswordInput, SimpleGrid, Stack, Text, TextInput, Textarea, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'
import Layout from './Layout'
import type { Project } from './types'

export default function Home() {
  const qc = useQueryClient()
  const [opened, { open, close }] = useDisclosure(false)
  const [editing, setEditing] = useState<Project | null>(null)
  const [deleting, setDeleting] = useState<Project | null>(null)
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') })

  const form = useForm({
    initialValues: { name: '', description: '', gitHubUrl: '', gitHubToken: '', clearGitHubToken: false },
    validate: { name: v => (v.trim() ? null : 'Required') },
  })

  const openCreate = () => {
    setEditing(null)
    form.reset()
    open()
  }

  const openEdit = (p: Project) => {
    setEditing(p)
    form.setValues({
      name: p.name,
      description: p.description ?? '',
      gitHubUrl: p.gitHubUrl ?? '',
      gitHubToken: '',
      clearGitHubToken: false,
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
        name: v.name.trim(),
        description: v.description.trim() || null,
        gitHubUrl: v.gitHubUrl.trim() || null,
        gitHubToken: v.gitHubToken.trim() || null,
        clearGitHubToken: v.clearGitHubToken,
      })
      return editing
        ? api(`/projects/${editing.id}`, { method: 'PUT', body })
        : api('/projects', { method: 'POST', body })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      if (editing) qc.invalidateQueries({ queryKey: ['project', editing.id] })
      closeForm()
    },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  const remove = useMutation({
    mutationFn: (p: Project) => api(`/projects/${p.id}`, { method: 'DELETE' }),
    onSuccess: (_, p) => {
      qc.removeQueries({ queryKey: ['project', p.id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      setDeleting(null)
    },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  return (
    <Layout>
      <Group justify="space-between" mb="md">
        <Title order={2}>Projects</Title>
        <Button onClick={openCreate}>New project</Button>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        {projects.map(p => (
          <Card key={p.id} withBorder>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Link to={`/projects/${p.id}`} style={{ flex: 1, minWidth: 0, color: 'inherit', textDecoration: 'none' }}>
                <Text fw={600}>{p.name}</Text>
                <Text size="sm" c="dimmed" lineClamp={2}>{p.description || 'No description'}</Text>
                {p.gitHubUrl && <Text size="xs" mt="xs" c="teal">{p.gitHubUrl}</Text>}
                {p.gitHubUrl && (
                  <Badge mt={6} size="xs" variant="light" color={p.hasGitHubToken ? 'teal' : 'yellow'}>
                    {p.hasGitHubToken ? 'Token configured' : 'No token'}
                  </Badge>
                )}
              </Link>
              <Menu position="bottom-end" withinPortal>
                <Menu.Target>
                  <Button variant="subtle" color="gray" size="compact-sm" aria-label={`Actions for ${p.name}`}>⋯</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => openEdit(p)}>Edit project</Menu.Item>
                  <Menu.Item color="red" onClick={() => setDeleting(p)}>Delete project</Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
      {projects.length === 0 && <Text c="dimmed">No projects yet.</Text>}

      <Modal opened={opened} onClose={closeForm} title={editing ? 'Edit project' : 'New project'}>
        <form onSubmit={form.onSubmit(v => save.mutate(v))}>
          <Stack>
            <TextInput label="Name" data-autofocus {...form.getInputProps('name')} />
            <Textarea label="Description" autosize minRows={2} {...form.getInputProps('description')} />
            <TextInput label="GitHub URL" placeholder="https://github.com/user/repo" {...form.getInputProps('gitHubUrl')} />
            <PasswordInput
              label="Fine-Grained GitHub PAT"
              description="Scope to this single repository with Contents (Read/Write) and Pull Requests (Read/Write)."
              placeholder={editing?.hasGitHubToken ? '•••••••• (saved — leave blank to keep)' : 'github_pat_...'}
              disabled={form.values.clearGitHubToken}
              {...form.getInputProps('gitHubToken')}
            />
            {editing?.hasGitHubToken && (
              <Checkbox
                label="Remove saved GitHub token"
                {...form.getInputProps('clearGitHubToken', { type: 'checkbox' })}
              />
            )}
            <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Create'}</Button>
          </Stack>
        </form>
      </Modal>

      <Modal opened={!!deleting} onClose={() => setDeleting(null)} title="Delete project">
        <Stack>
          <Text size="sm">
            This permanently deletes <b>{deleting?.name}</b> and everything in it. This can’t be undone.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button color="red" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              Delete project
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Layout>
  )
}