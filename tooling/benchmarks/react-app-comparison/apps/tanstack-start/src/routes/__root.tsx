/// <reference types="vite/client" />
import { HeadContent, Link, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import stylesheet from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'React application comparison' },
    ],
    links: [{ rel: 'stylesheet', href: stylesheet }],
  }),
  component: () => (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        <nav className="site-nav wrap" aria-label="Main navigation">
          <Link to="/products">Products</Link>
          <Link to="/admin/products">Editor</Link>
          <Link to="/jukebox">Jukebox</Link>
        </nav>
        <main className="wrap"><Outlet /></main>
        <Scripts />
      </body>
    </html>
  ),
})
