import { createFileRoute } from '@tanstack/react-router'
import { logout } from '../mutations.server'

export const Route = createFileRoute('/logout')({
  server: { handlers: { POST: () => logout() } },
})
