import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/jukebox/qr')({
  component: () => (
    <>
      <h2>Share the jukebox</h2>
      <p>Open the song library at <a href="/jukebox/songs">/jukebox/songs</a>.</p>
      <p className="muted">Audio stays active while switching between jukebox views.</p>
    </>
  ),
})
