import { createFileRoute } from '@tanstack/react-router'
import { login } from '../mutations.server'

export const Route = createFileRoute('/login')({
  server: { handlers: { POST: ({ request }) => login(request) } },
  component: () => (
    <>
      <h1>Editor sign in</h1>
      <form method="post" action="/login" className="panel stack">
        <label className="field">Username<input name="username" autoComplete="username" required /></label>
        <label className="field">Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <div><button type="submit">Sign in</button></div>
      </form>
    </>
  ),
})
