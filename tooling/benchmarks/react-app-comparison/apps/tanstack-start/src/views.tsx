import { Link } from '@tanstack/react-router'
import type { Product } from '../../../fixture/domain.mjs'

export function ProductList({ products, title = 'Products' }: { readonly products: readonly Product[]; readonly title?: string }) {
  return (
    <>
      <h1>{title}</h1>
      <div className="panel">
        {products.map((product) => (
          <div className="row" key={product.sku}>
            <Link to="/products/$sku" params={{ sku: product.sku }}>{product.name}</Link>
            <span className="muted">{product.sku}</span>
          </div>
        ))}
      </div>
    </>
  )
}
