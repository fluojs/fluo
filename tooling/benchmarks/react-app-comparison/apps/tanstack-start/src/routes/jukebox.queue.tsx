import { createFileRoute } from '@tanstack/react-router'
import { SONGS } from '../../../../fixture/domain.mjs'

export const Route = createFileRoute('/jukebox/queue')({
  component: () => (
    <div data-approved-view="queue">
      <h2>Queue</h2>
      <ol>
        {SONGS.map((song) => <li key={song.id}>{song.title}</li>)}
      </ol>
    </div>
  ),
})
