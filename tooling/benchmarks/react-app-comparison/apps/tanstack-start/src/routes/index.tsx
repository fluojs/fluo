import { createFileRoute } from '@tanstack/react-router'
import { ProductList } from '../views'
import { listProducts } from '../catalog'

export const Route = createFileRoute('/')({
  loader: () => listProducts(),
  component: () => <ProductList products={Route.useLoaderData().products} title={Route.useLoaderData().title} />,
})
