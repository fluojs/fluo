import { createFileRoute } from '@tanstack/react-router'
import { listProducts } from '../catalog'
import { ProductList } from '../views'
import { createProduct } from '../mutations.server'

export const Route = createFileRoute('/products/')({
  loader: () => listProducts(),
  server: { handlers: { POST: ({ request }) => createProduct(request) } },
  component: () => <ProductList products={Route.useLoaderData().products} />,
})
