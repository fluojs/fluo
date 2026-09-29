import { createFileRoute } from '@tanstack/react-router'
import { deleteProduct } from '../mutations.server'

export const Route = createFileRoute('/products/$sku/delete')({
  server: { handlers: { POST: ({ request, params }) => deleteProduct(request, params.sku) } },
})
