import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import AuthPage from './AuthPage'
import Home from './Home'
import { getToken } from './api'

const theme = createTheme({
  primaryColor: 'teal',
  defaultRadius: 'xs',
  headings: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
})

const Protected = ({ children }: { children: React.ReactNode }) =>
  getToken() ? <>{children}</> : <Navigate to="/auth" />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme} defaultColorScheme="dark">
    <Notifications />
    <QueryClientProvider client={new QueryClient()}>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/" element={<Protected><Home /></Protected>} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </MantineProvider>
)