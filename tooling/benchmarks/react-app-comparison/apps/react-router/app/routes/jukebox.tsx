import { useEffect, useRef, useState } from "react";
import { Link, Outlet, useLoaderData, useLocation, useNavigation } from "react-router";
import { createToneUrl } from "../../../../fixture/audio.mjs";
import { JUKEBOX_VIEWS, SONGS } from "../../../../fixture/domain.mjs";

export function loader() {
  return { resourceId: crypto.randomUUID() };
}

export default function Jukebox() {
  const { resourceId } = useLoaderData<typeof loader>();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [identity] = useState(resourceId);
  const [ack, setAck] = useState(0);
  const operations = useRef(0);
  const location = useLocation();
  const navigation = useNavigation();

  useEffect(() => {
    const url = createToneUrl();
    const resource = new Audio(url);
    resource.loop = true;
    audio.current = resource;
    return () => {
      resource.pause();
      resource.removeAttribute("src");
      resource.load();
      URL.revokeObjectURL(url);
      audio.current = null;
    };
  }, []);

  async function operate() {
    const resource = audio.current;
    if (!resource) return;
    if (resource.paused) {
      await resource.play();
      if (resource.paused) return;
    } else {
      resource.pause();
    }
    operations.current += 1;
    setAck(operations.current);
  }

  return (
    <section data-testid="jukebox-resource" data-instance={identity} data-resource-id={identity}>
      <p className="lede">A live audio resource stays mounted while the jukebox view changes.</p>
      <h1>Jukebox</h1>
      <nav className="tabs" aria-label="Jukebox views">
        {JUKEBOX_VIEWS.map((view) => (
          <Link
            key={view}
            to={`/jukebox/${view}`}
            aria-current={location.pathname === `/jukebox/${view}` ? "page" : undefined}
          >
            {view === "qr" ? "QR" : view.charAt(0).toUpperCase() + view.slice(1)}
          </Link>
        ))}
      </nav>
      {navigation.state !== "idle" && <output data-navigation-pending role="status">Opening view</output>}
      <div className="card">
        <h2>Shared songs</h2>
        <ul>{SONGS.map((song) => <li key={song.id}>{song.title}</li>)}</ul>
        <button data-testid="jukebox-operation" type="button" onClick={() => void operate()}>Operate resource</button>
        <p aria-live="polite" data-testid="jukebox-ack" data-operation-ack={ack}>{ack}</p>
      </div>
      <Outlet />
    </section>
  );
}
