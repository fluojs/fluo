import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/jukebox/songs')({
  component: () => (
    <div data-approved-view="songs">
      <h2>Songs</h2>
      <p className="muted">Play the local audio sample while browsing the library.</p>
    </div>
  ),
})
