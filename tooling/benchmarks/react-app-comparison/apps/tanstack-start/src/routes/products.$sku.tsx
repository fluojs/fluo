import { createFileRoute, Link } from '@tanstack/react-router'
import { getProduct } from '../catalog'
import { updateProduct } from '../mutations.server'

export const Route = createFileRoute('/products/$sku')({
  loader: ({ params }) => getProduct({ data: params.sku }),
  server: { handlers: { POST: ({ request, params }) => updateProduct(request, params.sku) } },
  component: ProductDetail,
})

function ProductDetail() {
  const product = Route.useLoaderData()
  return (
    <>
      <Link to="/products">All products</Link>
      <h1>{product.name}</h1>
      <p className="muted">SKU {product.sku}</p>
      <div className="panel">
        <h2>Edit product</h2>
        <form method="post" action={`/products/${encodeURIComponent(product.sku)}`} className="stack">
          <label className="field">Name<input name="name" defaultValue={product.name} required minLength={3} /></label>
          <div><button type="submit">Save changes</button></div>
        </form>
      </div>
      <form method="post" action={`/products/${encodeURIComponent(product.sku)}/delete`}>
        <button type="submit">Delete product</button>
      </form>
    </>
  )
}
