import Link from 'next/link';
import './style.css';
import './benchmark.css';

export const metadata = {
  title: 'Benchmark catalog',
  description: 'Product catalog and persistent jukebox comparison fixture',
};

export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link className="wordmark" href="/products">Catalog / Next</Link>
          <nav aria-label="Main navigation">
            <Link href="/products">Products</Link>
            <Link href="/admin/products">Admin</Link>
            <Link href="/jukebox/songs">Jukebox</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
