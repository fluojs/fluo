import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { createToneUrl } from '../../../../fixture/audio.mjs'
import { SONGS } from '../../../../fixture/domain.mjs'

export const Route = createFileRoute('/jukebox')({
  loader: () => crypto.randomUUID(),
  component: Jukebox,
})

function Jukebox() {
  const mountId = Route.useLoaderData()
  const navigationStatus = useRouterState({ select: (state) => state.status })
  const audio = useRef<HTMLAudioElement>(null)
  const [resourceId] = useState(mountId)
  const [source, setSource] = useState<string>()
  const [playing, setPlaying] = useState(false)
  const [ack, setAck] = useState(0)

  useEffect(() => {
    const url = createToneUrl()
    setSource(url)
    return () => URL.revokeObjectURL(url)
  }, [])

  async function operate() {
    const player = audio.current
    if (!player) return
    if (!player.paused) {
      player.pause()
      return
    }
    try {
      await player.play()
    } catch (error) {
      if (error instanceof Error) {
        setPlaying(false)
        // An operation rejected by the browser is an acknowledgement, not playback.
        setAck((previous) => previous + 1)
      } else {
        throw error
      }
    }
  }

  return (
    <>
      <h1>Jukebox</h1>
      <section className="panel transport" aria-label="Audio transport">
        <audio
          ref={audio}
          src={source}
          loop
          preload="auto"
          onPlay={() => { setPlaying(true); setAck((previous) => previous + 1) }}
          onPause={() => { setPlaying(false); setAck((previous) => previous + 1) }}
        />
        <button data-testid="jukebox-operation" aria-label="Operate resource" onClick={operate} disabled={!source} type="button">
          {playing ? 'Pause audio' : 'Play audio'}
        </button>
        <span data-testid="jukebox-resource" data-instance={resourceId} data-resource-id={resourceId} data-benchmark-hydrated={Boolean(source)}>Audio resource</span>
        <span data-testid="jukebox-ack" data-operation-ack={ack} role="status">{ack}</span>
      </section>
      <nav className="tabs" aria-label="Jukebox views">
        <Link to="/jukebox/songs">Songs</Link>
        <Link to="/jukebox/qr">QR</Link>
        <Link to="/jukebox/queue">Queue</Link>
      </nav>
      {navigationStatus === 'pending' && <output data-navigation-pending role="status">Opening view</output>}
      <section className="panel">
        <Outlet />
      </section>
      <section aria-label="Song library">
        <h2>Song library</h2>
        {SONGS.map((song) => <div className="row" key={song.id}>{song.title}</div>)}
      </section>
    </>
  )
}
