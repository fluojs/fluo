import { notFound } from 'next/navigation';
import { JUKEBOX_VIEWS } from '../../../../../fixture/domain.mjs';

export default async function JukeboxView({ params }) {
  const { view } = await params;
  if (!JUKEBOX_VIEWS.includes(view)) notFound();
  if (view === 'qr') {
    return (
      <section data-approved-view={view}>
        <h2>Share the listening room</h2>
        <p>Invite a listener with this direct room link: <a href="/jukebox/songs">Open songs</a>.</p>
      </section>
    );
  }
  if (view === 'queue') {
    return (
      <section data-approved-view={view}>
        <h2>Queue</h2>
        <p>Add songs from the library below. Your queue and active audio stay with you while you navigate these views.</p>
      </section>
    );
  }
  return (
    <section data-approved-view={view}>
      <h2>Songs</h2>
      <p>Select a song from the library to add it to your listening queue, or play the local audio resource.</p>
    </section>
  );
}
