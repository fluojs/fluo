import {
  SESSION_COOKIE,
  SESSION_VALUE,
  authenticate,
  isEditor,
  validateProduct,
} from '../../../fixture/domain.mjs'
import { catalog } from './catalog.server'

const noStore = { 'Cache-Control': 'no-store' }

export async function login(request: Request): Promise<Response> {
  const fields = new URLSearchParams(await request.text())
  if (!authenticate(fields.get('username'), fields.get('password'))) {
    return new Response('Invalid credentials', { status: 401, headers: noStore })
  }
  return new Response(null, {
    status: 303,
    headers: {
      ...noStore,
      Location: '/admin/products',
      'Set-Cookie': `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
    },
  })
}

export function logout(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      ...noStore,
      Location: '/products',
      'Set-Cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  })
}

function forbidden(request: Request): Response | undefined {
  return isEditor(request.headers.get('cookie'))
    ? undefined
    : new Response('Editor access required', { status: 403, headers: noStore })
}

export async function createProduct(request: Request): Promise<Response> {
  const denied = forbidden(request)
  if (denied) return denied
  const result = validateProduct((await request.formData()).get('name'))
  if (!result.ok) return new Response(result.code, { status: 400, headers: noStore })
  const product = catalog.create(result.name)
  return new Response(null, {
    status: 303,
    headers: { ...noStore, Location: `/products/${product.sku}` },
  })
}

export async function updateProduct(request: Request, sku: string): Promise<Response> {
  const denied = forbidden(request)
  if (denied) return denied
  const result = validateProduct((await request.formData()).get('name'))
  if (!result.ok) return new Response(result.code, { status: 400, headers: noStore })
  if (!catalog.update(sku, result.name)) {
    return new Response('Product not found', { status: 404, headers: noStore })
  }
  return new Response(null, {
    status: 303,
    headers: { ...noStore, Location: `/products/${sku}` },
  })
}

export function deleteProduct(request: Request, sku: string): Response {
  const denied = forbidden(request)
  if (denied) return denied
  if (!catalog.delete(sku)) return new Response('Product not found', { status: 404, headers: noStore })
  return new Response(null, { status: 303, headers: { ...noStore, Location: '/admin/products' } })
}
