import { createFileRoute, Link } from '@tanstack/react-router'
import { requireEditor } from '../catalog'

export const Route = createFileRoute('/admin/products')({
  loader: () => requireEditor(),
  component: AdminProducts,
})

function AdminProducts() {
  const products = Route.useLoaderData()
  return (
    <>
      <h1>Manage products</h1>
      <form method="post" action="/logout"><button type="submit">Sign out</button></form>
      <div className="panel">
        <h2>Catalog</h2>
        {products.map((product) => (
          <div className="row" key={product.sku}>
            <Link to="/products/$sku" params={{ sku: product.sku }}>{product.name}</Link>
            <span className="muted">{product.sku}</span>
          </div>
        ))}
      </div>
      <form method="post" action="/products" className="panel stack">
        <h2>Add product</h2>
        <label className="field">Name<input name="name" required minLength={3} /></label>
        <div><button type="submit">Create product</button></div>
      </form>
    </>
  )
}
