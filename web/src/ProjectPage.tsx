import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Badge, Button, Checkbox, Group, Modal, PasswordInput, Stack, Tabs, Text, Textarea, TextInput, Title } from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { api } from './api'
import Layout from './Layout'
import Board from './Board'
import AgentsTab from './AgentsTab'
import MembersTab from './MembersTab'
import type { Project } from './types'

export default function ProjectPage() {
  const { id } = useParams() as { id: string }
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: project } = useQuery({ queryKey: ['project', id], queryFn: () => api<Project>(`/projects/${id}`) })

  const [editOpen, editModal] = useDisclosure(false)
  const [deleteOpen, deleteModal] = useDisclosure(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [gitHubUrl, setGitHubUrl] = useState('')
  const [gitHubToken, setGitHubToken] = useState('')
  const [clearGitHubToken, setClearGitHubToken] = useState(false)

  const openEdit = () => {
    setName(project?.name ?? '')
    setDescription(project?.description ?? '')
    setGitHubUrl(project?.gitHubUrl ?? '')
    setGitHubToken('')
    setClearGitHubToken(false)
    save.reset()
    editModal.open()
  }

  const save = useMutation({
    mutationFn: () =>
      api(`/projects/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          gitHubUrl: gitHubUrl.trim() || null,
          gitHubToken: gitHubToken.trim() || null,
          clearGitHubToken,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      editModal.close()
    },
  })

  const remove = useMutation({
    mutationFn: () => api(`/projects/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['project', id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      navigate('/')
    },
  })

  return (
    <Layout>
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{project?.name}</Title>
          {project?.description && <Text size="sm" mt={4}>{project.description}</Text>}
          <Group gap="xs" mt={4} mb="md">
            <Text size="sm" c="dimmed">{project?.gitHubUrl}</Text>
            {project?.gitHubUrl && (
              <Badge size="xs" variant="light" color={project.hasGitHubToken ? 'teal' : 'yellow'}>
                {project.hasGitHubToken ? 'Token configured' : 'No token'}
              </Badge>
            )}
          </Group>
        </div>
        <Group gap="xs">
          <Button variant="default" onClick={openEdit} disabled={!project}>Edit project</Button>
          <Button
            color="red"
            variant="light"
            onClick={() => { remove.reset(); deleteModal.open() }}
            disabled={!project}
          >
            Delete project
          </Button>
        </Group>
      </Group>

      <Tabs defaultValue="board">
        <Tabs.List mb="md">
          <Tabs.Tab value="board">Board</Tabs.Tab>
          <Tabs.Tab value="agents">Agents</Tabs.Tab>
          <Tabs.Tab value="members">Members</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="board"><Board projectId={id} /></Tabs.Panel>
        <Tabs.Panel value="agents"><AgentsTab projectId={id} /></Tabs.Panel>
        <Tabs.Panel value="members"><MembersTab projectId={id} /></Tabs.Panel>
      </Tabs>

      <Modal opened={editOpen} onClose={editModal.close} title="Edit project">
        <Stack>
          <TextInput
            label="Name"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            data-autofocus
          />
          <Textarea
            label="Description"
            autosize
            minRows={2}
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
          <TextInput
            label="GitHub URL"
            placeholder="https://github.com/owner/repo"
            value={gitHubUrl}
            onChange={(e) => setGitHubUrl(e.currentTarget.value)}
          />
          <PasswordInput
            label="Fine-Grained GitHub PAT"
            description="Scope to this single repository with Contents (Read/Write) and Pull Requests (Read/Write)."
            placeholder={project?.hasGitHubToken ? '•••••••• (saved — leave blank to keep)' : 'github_pat_...'}
            value={gitHubToken}
            disabled={clearGitHubToken}
            onChange={(e) => setGitHubToken(e.currentTarget.value)}
          />
          {project?.hasGitHubToken && (
            <Checkbox
              label="Remove saved GitHub token"
              checked={clearGitHubToken}
              onChange={(e) => setClearGitHubToken(e.currentTarget.checked)}
            />
          )}
          {save.isError && <Text c="red" size="sm">Couldn’t save changes. Try again.</Text>}
          <Group justify="flex-end">
            <Button variant="default" onClick={editModal.close}>Cancel</Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim()}>
              Save changes
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={deleteOpen} onClose={deleteModal.close} title="Delete project">
        <Stack>
          <Text size="sm">
            This permanently deletes <b>{project?.name}</b> and everything in it. This can’t be undone.
          </Text>
          {remove.isError && (
            <Text c="red" size="sm">Couldn’t delete the project. Only the project owner can delete it.</Text>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={deleteModal.close}>Cancel</Button>
            <Button color="red" onClick={() => remove.mutate()} loading={remove.isPending}>
              Delete project
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Layout>
  )
}