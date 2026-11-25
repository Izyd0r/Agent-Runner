import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Avatar, Button, Group, Modal, PasswordInput, Stack, Tabs, Text, TextInput } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { api } from './api'

export interface Me {
  id: string
  email: string
  displayName?: string | null
  gitHubUsername?: string | null
  roleTitle?: string | null
}

export default function AccountModal({
  opened,
  onClose,
  user,
}: {
  opened: boolean
  onClose: () => void
  user?: Me
}) {
  const qc = useQueryClient()

  const profileForm = useForm({
    initialValues: { displayName: '', gitHubUsername: '', roleTitle: '' },
    validate: { displayName: v => (v.trim() ? null : 'Display name is required') },
  })

  const emailForm = useForm({
    initialValues: { newEmail: '', currentPassword: '' },
    validate: {
      newEmail: v => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Invalid email'),
      currentPassword: v => (v ? null : 'Current password is required'),
    },
  })

  const passwordForm = useForm({
    initialValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    validate: {
      currentPassword: v => (v ? null : 'Required'),
      newPassword: v => (v.length >= 6 ? null : 'Min 6 characters'),
      confirmPassword: (v, vals) => (v !== vals.newPassword ? 'Passwords do not match' : null),
    },
  })

  useEffect(() => {
    if (!opened || !user) return
    profileForm.setValues({
      displayName: user.displayName ?? '',
      gitHubUsername: user.gitHubUsername ?? '',
      roleTitle: user.roleTitle ?? '',
    })
    profileForm.resetDirty()
    emailForm.setValues({ newEmail: user.email, currentPassword: '' })
    emailForm.resetDirty()
    passwordForm.reset()
  }, [opened, user]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateProfile = useMutation({
    mutationFn: (v: typeof profileForm.values) =>
      api<Me>('/me', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: v.displayName.trim(),
          gitHubUsername: v.gitHubUsername.trim() || null,
          roleTitle: v.roleTitle.trim() || null,
        }),
      }),
    onSuccess: updated => {
      qc.setQueryData(['me'], updated)
      notifications.show({ color: 'teal', message: 'Profile saved' })
    },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  const changeEmail = useMutation({
    mutationFn: (v: typeof emailForm.values) =>
      api<Me>('/me/email', {
        method: 'POST',
        body: JSON.stringify({
          newEmail: v.newEmail.trim(),
          currentPassword: v.currentPassword,
        }),
      }),
    onSuccess: updated => {
      qc.setQueryData(['me'], updated)
      emailForm.setFieldValue('currentPassword', '')
      notifications.show({ color: 'teal', message: 'Email address updated' })
    },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  const changePassword = useMutation({
    mutationFn: (v: typeof passwordForm.values) =>
      api('/me/password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: v.currentPassword,
          newPassword: v.newPassword,
        }),
      }),
    onSuccess: () => {
      passwordForm.reset()
      notifications.show({ color: 'teal', message: 'Password updated' })
    },
    onError: e => notifications.show({ color: 'red', message: (e as Error).message }),
  })

  const initials = (user?.displayName || user?.email || '?').slice(0, 2).toUpperCase()

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      size="md"
      title={
        <Group gap="sm">
          <Avatar size="sm" radius="xl" color="teal">{initials}</Avatar>
          <div>
            <Text size="sm" fw={600} lh={1.2}>{user?.displayName || 'Account settings'}</Text>
            <Text size="xs" c="dimmed" lh={1.2}>{user?.email}</Text>
          </div>
        </Group>
      }
    >
      <Tabs defaultValue="profile">
        <Tabs.List mb="md">
          <Tabs.Tab value="profile">Profile</Tabs.Tab>
          <Tabs.Tab value="email">Email</Tabs.Tab>
          <Tabs.Tab value="password">Password</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="profile">
          <form onSubmit={profileForm.onSubmit(v => updateProfile.mutate(v))}>
            <Stack gap="sm">
              <TextInput label="Display name" required {...profileForm.getInputProps('displayName')} />
              <TextInput label="GitHub username" placeholder="janedoe" {...profileForm.getInputProps('gitHubUsername')} />
              <TextInput label="Role / Title" placeholder="Backend Engineer" {...profileForm.getInputProps('roleTitle')} />
              <Group justify="flex-end" mt="xs">
                <Button type="submit" loading={updateProfile.isPending}>Save profile</Button>
              </Group>
            </Stack>
          </form>
        </Tabs.Panel>

        <Tabs.Panel value="email">
          <form onSubmit={emailForm.onSubmit(v => changeEmail.mutate(v))}>
            <Stack gap="sm">
              <Text size="xs" c="dimmed">
                Your email is also used to log in and receive project invites.
              </Text>
              <TextInput label="Email address" required {...emailForm.getInputProps('newEmail')} />
              <PasswordInput
                label="Confirm with current password"
                required
                {...emailForm.getInputProps('currentPassword')}
              />
              <Group justify="flex-end" mt="xs">
                <Button type="submit" loading={changeEmail.isPending}>Update email</Button>
              </Group>
            </Stack>
          </form>
        </Tabs.Panel>

        <Tabs.Panel value="password">
          <form onSubmit={passwordForm.onSubmit(v => changePassword.mutate(v))}>
            <Stack gap="sm">
              <PasswordInput label="Current password" required {...passwordForm.getInputProps('currentPassword')} />
              <PasswordInput label="New password" required {...passwordForm.getInputProps('newPassword')} />
              <PasswordInput label="Confirm new password" required {...passwordForm.getInputProps('confirmPassword')} />
              <Group justify="flex-end" mt="xs">
                <Button type="submit" loading={changePassword.isPending}>Update password</Button>
              </Group>
            </Stack>
          </form>
        </Tabs.Panel>
      </Tabs>
    </Modal>
  )
}