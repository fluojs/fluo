import {
  Links,
  Link,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useLoaderData,
  useRouteError,
} from "react-router";
import type { Route } from "./+types/root";
import { isEditor } from "../../../fixture/domain.mjs";
import "./styles.css";

export function loader({ request }: Route.LoaderArgs) {
  return { editor: isEditor(request.headers.get("cookie")) };
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function Root() {
  const { editor } = useLoaderData<typeof loader>();
  return (
    <div className="site">
      <header className="masthead">
        <a className="brand" href="/">Same App / React Router</a>
        <nav aria-label="Primary navigation">
          <a href="/">Catalog</a>
          <Link to="/jukebox/songs?from=global">Jukebox</Link>
        </nav>
        <div className="account">
          {editor ? (
            <form action="/logout" method="post">
              <span>Editor</span> <button type="submit">Log out</button>
            </form>
          ) : (
            <a href="/login">Editor login</a>
          )}
        </div>
      </header>
      <main><Outlet /></main>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  return (
    <main className="error">
      <h1>{status === 404 ? "Not found" : status === 403 ? "Access denied" : "Request failed"}</h1>
      <p>{isRouteErrorResponse(error) ? error.data : "The requested page could not be loaded."}</p>
      <a href="/">Return to catalog</a>
    </main>
  );
}
