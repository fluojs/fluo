import type { Route } from "./+types/jukebox-view";
import { JUKEBOX_VIEWS } from "../../../../fixture/domain.mjs";

export function loader({ params }: Route.LoaderArgs) {
  if (!JUKEBOX_VIEWS.some((view) => view === params.view)) {
    throw new Response("Unknown jukebox view", { status: 404 });
  }
  return { view: params.view };
}

export default function JukeboxView({ loaderData }: Route.ComponentProps) {
  const { view } = loaderData;
  return (
    <section className="card" data-approved-view={view}>
      <h2>{view === "qr" ? "QR" : view.charAt(0).toUpperCase() + view.slice(1)} view</h2>
      {view === "songs" && <p>Choose a song from the shared catalog above.</p>}
      {view === "qr" && <p>Share this jukebox with a listening partner.</p>}
      {view === "queue" && <p>Your listening queue is ready.</p>}
    </section>
  );
}
