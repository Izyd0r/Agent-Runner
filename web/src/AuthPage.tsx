import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Anchor, Button, Center, Group, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { forgotPassword, login, register, resetPassword } from './api'

type AuthMode = 'login' | 'register' | 'forgot' | 'sent' | 'reset'

export default function AuthPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialMode = (searchParams.get('mode') as AuthMode) || 'login'
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()

  const form = useForm({
    initialValues: {
      displayName: '',
      email: searchParams.get('email') ?? '',
      gitHubUsername: '',
      roleTitle: '',
      password: '',
      confirmPassword: '',
      resetCode: searchParams.get('code') ?? '',
    },
    validate: {
      displayName: v => (mode === 'register' && !v.trim() ? 'Display name is required' : null),
      email: v => (mode === 'reset' || /^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'Invalid email'),
      password: v =>
        mode === 'forgot' || mode === 'sent' || v.length >= 6 ? null : 'Min 6 characters',
      confirmPassword: (v, values) =>
        (mode === 'register' || mode === 'reset') && v !== values.password
          ? 'Passwords do not match'
          : null,
    },
  })

  useEffect(() => {
    const urlMode = searchParams.get('mode') as AuthMode | null
    if (urlMode === 'reset') {
      setMode('reset')
      form.setValues({
        email: searchParams.get('email') ?? '',
        resetCode: searchParams.get('code') ?? '',
      })
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  function switchMode(next: AuthMode) {
    setMode(next)
    form.clearErrors()
    if (searchParams.toString()) setSearchParams({})
  }

  async function submit(values: typeof form.values) {
    setLoading(true)
    try {
      const email = values.email.trim()

      if (mode === 'forgot') {
        await forgotPassword(email)
        setMode('sent')
        return
      }

      if (mode === 'reset') {
        if (!values.resetCode) {
          throw new Error('Invalid or missing reset link. Request a new password reset email.')
        }
        await resetPassword(email, values.resetCode, values.password)
        notifications.show({
          color: 'teal',
          title: 'Password updated',
          message: 'You can now log in with your new password.',
        })
        form.setFieldValue('password', '')
        form.setFieldValue('confirmPassword', '')
        switchMode('login')
        return
      }

      if (mode === 'register') {
        await register({
          email,
          password: values.password,
          displayName: values.displayName.trim(),
          gitHubUsername: values.gitHubUsername.trim() || undefined,
          roleTitle: values.roleTitle.trim() || undefined,
        })
      }

      await login(email, values.password)
      nav('/')
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  if (mode === 'sent') {
    return (
      <Center mih="100vh" py="xl">
        <Paper w={400} p="xl" withBorder>
          <Stack>
            <Title order={2}>Check your email</Title>
            <Text size="sm" c="dimmed">
              If an account exists for <b>{form.values.email}</b>, we sent a password reset link. Click the link in the email to choose a new password.
            </Text>
            <Button variant="light" onClick={() => switchMode('login')}>
              Back to log in
            </Button>
          </Stack>
        </Paper>
      </Center>
    )
  }

  const titleMap: Record<Exclude<AuthMode, 'sent'>, string> = {
    login: 'Log in',
    register: 'Create account',
    forgot: 'Forgot password',
    reset: 'Set new password',
  }

  const buttonMap: Record<Exclude<AuthMode, 'sent'>, string> = {
    login: 'Log in',
    register: 'Create account',
    forgot: 'Send reset link',
    reset: 'Reset password',
  }

  return (
    <Center mih="100vh" py="xl">
      <Paper w={400} p="xl" withBorder>
        <form onSubmit={form.onSubmit(submit)}>
          <Stack>
            <Title order={2}>{titleMap[mode]}</Title>

            {mode === 'forgot' && (
              <Text size="sm" c="dimmed">
                Enter your account email and we’ll send you a link to reset your password.
              </Text>
            )}

            {mode === 'reset' && (
              <Text size="sm" c="dimmed">
                Choose a new password for <b>{form.values.email}</b>.
              </Text>
            )}

            {mode === 'register' && (
              <TextInput
                label="Display name"
                placeholder="Jane Doe"
                required
                data-autofocus
                {...form.getInputProps('displayName')}
              />
            )}

            {mode !== 'reset' && (
              <TextInput
                label="Email"
                placeholder="jane@example.com"
                required
                data-autofocus={mode === 'login' || mode === 'forgot'}
                {...form.getInputProps('email')}
              />
            )}

            {mode === 'register' && (
              <>
                <TextInput
                  label="GitHub username"
                  placeholder="janedoe (optional)"
                  {...form.getInputProps('gitHubUsername')}
                />
                <TextInput
                  label="Role / Title"
                  placeholder="Backend Engineer (optional)"
                  {...form.getInputProps('roleTitle')}
                />
              </>
            )}

            {mode !== 'forgot' && (
              <div>
                <PasswordInput
                  label={mode === 'reset' ? 'New password' : 'Password'}
                  required
                  data-autofocus={mode === 'reset'}
                  {...form.getInputProps('password')}
                />
                {mode === 'login' && (
                  <Group justify="flex-end" mt={4}>
                    <Anchor component="button" type="button" size="xs" onClick={() => switchMode('forgot')}>
                      Forgot password?
                    </Anchor>
                  </Group>
                )}
              </div>
            )}

            {(mode === 'register' || mode === 'reset') && (
              <PasswordInput
                label="Confirm password"
                required
                {...form.getInputProps('confirmPassword')}
              />
            )}

            <Button type="submit" loading={loading}>
              {buttonMap[mode]}
            </Button>

            <Text size="sm" ta="center">
              {mode === 'login' ? (
                <Anchor component="button" type="button" onClick={() => switchMode('register')}>
                  Need an account?
                </Anchor>
              ) : (
                <Anchor component="button" type="button" onClick={() => switchMode('login')}>
                  Back to log in
                </Anchor>
              )}
            </Text>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}