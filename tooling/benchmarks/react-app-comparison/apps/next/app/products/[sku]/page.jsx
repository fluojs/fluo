import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { SESSION_COOKIE, SESSION_VALUE } from '../../../../../fixture/domain.mjs';
import { catalog } from '../../../lib/catalog';

export const dynamic = 'force-dynamic';

export default async function ProductDetail({ params }) {
  const { sku } = await params;
  const product = catalog.detail(sku);
  if (!product) notFound();
  const editor = (await cookies()).get(SESSION_COOKIE)?.value === SESSION_VALUE;
  return (
    <>
      <p className="eyebrow">Product detail</p>
      <h1>{product.name}</h1>
      <p className="sku">{product.sku}</p>
      <p><Link href="/products">Back to products</Link></p>
      {editor ? (
        <section className="panel">
          <h2>Edit product</h2>
          <form method="post" action={`/products/${sku}`}>
            <label>Product name <input name="name" defaultValue={product.name} minLength={3} required /></label>
            <button type="submit">Update</button>
          </form>
          <form method="post" action={`/products/${sku}/delete`}>
            <button className="danger" type="submit">Delete</button>
          </form>
          <form method="post" action="/logout">
            <button className="secondary" type="submit">Sign out</button>
          </form>
        </section>
      ) : <p><Link href="/login">Sign in to edit</Link></p>}
    </>
  );
}
