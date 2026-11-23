import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Anchor, Button, Center, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import { login, register } from './api'

export default function AuthPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loading, setLoading] = useState(false)
  const nav = useNavigate()

  const form = useForm({
    initialValues: { email: '', password: '' },
    validate: {
      email: v => (/^\S+@\S+$/.test(v) ? null : 'Invalid email'),
      password: v => (v.length >= 6 ? null : 'Min 6 characters'),
    },
  })

  async function submit(values: { email: string; password: string }) {
    setLoading(true)
    try {
      if (mode === 'register') await register(values.email, values.password)
      await login(values.email, values.password)
      nav('/')
    } catch (err) {
      notifications.show({ color: 'red', title: 'Error', message: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Center h="100vh">
      <Paper w={360} p="xl" withBorder>
        <form onSubmit={form.onSubmit(submit)}>
          <Stack>
            <Title order={2}>{mode === 'login' ? 'Log in' : 'Register'}</Title>
            <TextInput label="Email" {...form.getInputProps('email')} />
            <PasswordInput label="Password" {...form.getInputProps('password')} />
            <Button type="submit" loading={loading}>
              {mode === 'login' ? 'Log in' : 'Create account'}
            </Button>
            <Text size="sm" ta="center">
              <Anchor component="button" type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
                {mode === 'login' ? 'Need an account?' : 'Have an account?'}
              </Anchor>
            </Text>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}