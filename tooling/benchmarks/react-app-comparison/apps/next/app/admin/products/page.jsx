import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, SESSION_VALUE } from '../../../../../fixture/domain.mjs';
import { catalog } from '../../../lib/catalog';

export const dynamic = 'force-dynamic';

export default async function AdminProducts() {
  if ((await cookies()).get(SESSION_COOKIE)?.value !== SESSION_VALUE) redirect('/login');

  return (
    <>
      <p className="eyebrow">Editor workspace</p>
      <h1>Manage products</h1>
      <form method="post" action="/logout"><button className="secondary" type="submit">Sign out</button></form>
      <section className="panel">
        <h2>Create product</h2>
        <form method="post" action="/products">
          <label>Product name <input name="name" minLength={3} required /></label>
          <button type="submit">Create</button>
        </form>
      </section>
      <section className="panel">
        <h2>Current products</h2>
        {catalog.list().map(({ sku, name }) => (
          <div key={sku}>
            <Link href={`/products/${sku}`}>{name}</Link> <span className="sku">{sku}</span>
            <form method="post" action={`/products/${sku}`}>
              <label>Rename {sku} <input name="name" defaultValue={name} minLength={3} required /></label>
              <button type="submit">Update</button>
            </form>
            <form method="post" action={`/products/${sku}/delete`}>
              <button className="danger" type="submit">Delete {name}</button>
            </form>
          </div>
        ))}
      </section>
    </>
  );
}
