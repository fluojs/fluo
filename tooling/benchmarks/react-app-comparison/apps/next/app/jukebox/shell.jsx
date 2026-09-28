'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createToneUrl } from '../../../../fixture/audio.mjs';

function NavigationPending() {
  const { pending } = useLinkStatus();
  return pending ? <span data-navigation-pending role="status">Opening view</span> : null;
}

export default function JukeboxShell({ songs, children }) {
  const pathname = usePathname();
  const audio = useRef(null);
  const pendingOperation = useRef(null);
  const [resource, setResource] = useState('initializing');
  const [ack, setAck] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('Ready to play');
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    const url = createToneUrl();
    const player = new Audio(url);
    player.loop = true;
    audio.current = player;
    setResource(crypto.randomUUID());
    const started = () => {
      if (pendingOperation.current !== 'play') return;
      pendingOperation.current = null;
      setPlaying(true);
      setStatus('Playback started');
      setAck((value) => value + 1);
    };
    const stopped = () => {
      if (pendingOperation.current !== 'pause') return;
      pendingOperation.current = null;
      setPlaying(false);
      setStatus('Playback paused');
      setAck((value) => value + 1);
    };
    player.addEventListener('playing', started);
    player.addEventListener('pause', stopped);
    return () => {
      player.pause();
      player.removeEventListener('playing', started);
      player.removeEventListener('pause', stopped);
      audio.current = null;
      URL.revokeObjectURL(url);
    };
  }, []);

  async function operate() {
    if (!audio.current || pendingOperation.current) return;
    if (!audio.current.paused) {
      pendingOperation.current = 'pause';
      audio.current.pause();
      return;
    }
    pendingOperation.current = 'play';
    try {
      await audio.current.play();
    } catch (error) {
      pendingOperation.current = null;
      setStatus(error instanceof Error ? `Playback unavailable: ${error.message}` : 'Playback unavailable');
    }
  }

  return (
    <section className="room" aria-label="Jukebox">
      <p className="eyebrow">Listening room</p>
      <h1>Jukebox</h1>
      <nav className="room-nav" aria-label="Jukebox views">
        {['songs', 'qr', 'queue'].map((view) => (
          <Link key={view} href={`/jukebox/${view}`} prefetch={false} aria-current={pathname === `/jukebox/${view}` ? 'page' : undefined}>
            {view === 'qr' ? 'QR' : view[0].toUpperCase() + view.slice(1)} <NavigationPending />
          </Link>
        ))}
      </nav>
      <div className="player">
        <p>Player resource <span data-testid="jukebox-resource" data-instance={resource} data-resource-id={resource} className="sku">{resource}</span></p>
        <button data-testid="jukebox-operation" type="button" aria-label="Operate resource" onClick={operate}>{playing ? 'Pause audio' : 'Play audio'}</button>
        <output data-testid="jukebox-ack" data-operation-ack={ack} aria-label="Audio operation acknowledgements">{ack}</output>
        <p role="status">{status}</p>
      </div>
      {children}
      <section aria-label="Song library">
        <h2>Song library</h2>
        <ul className="room-list">
          {songs.map((song) => (
            <li key={song.id}>
              <span>{song.title}</span>
              <button type="button" onClick={() => setQueue((items) => [...items, song])}>Add to queue</button>
            </li>
          ))}
        </ul>
      </section>
      <p aria-live="polite">Queue: {queue.length ? queue.map((song) => song.title).join(', ') : 'Nothing queued yet'}</p>
    </section>
  );
}
