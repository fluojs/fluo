import Link from 'next/link';
import { catalog, devCatalogTitle } from '../../lib/catalog';
import HydrationSignal from './hydration';

export const dynamic = 'force-dynamic';

export default function Products() {
  return (
    <>
      <HydrationSignal />
      <p className="eyebrow">Product catalog</p>
      <h1>{devCatalogTitle}</h1>
      <p className="lede">A shared catalog of seeded products, with changes available to signed-in editors.</p>
      <section className="panel" aria-label="Available products">
        <ul className="rows">
          {catalog.list().map(({ sku, name }) => (
            <li key={sku}>
              <Link href={`/products/${sku}`}>{name}</Link>
              <span className="sku">{sku}</span>
            </li>
          ))}
        </ul>
      </section>
      <Link href="/admin/products">Manage products</Link>
    </>
  );
}
