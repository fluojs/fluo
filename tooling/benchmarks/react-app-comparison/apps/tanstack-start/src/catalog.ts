import { createServerFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { notFound, redirect } from '@tanstack/react-router'
import { isEditor } from '../../../fixture/domain.mjs'
import { catalog, devCatalogTitle } from './catalog.server'

export const listProducts = createServerFn({ method: 'GET' }).handler(() => ({
  products: catalog.list(),
  title: devCatalogTitle,
}))

export const getProduct = createServerFn({ method: 'GET' })
  .inputValidator((sku: string) => sku)
  .handler(({ data: sku }) => {
    if (isEditor(getRequest().headers.get('cookie'))) setResponseHeader('Cache-Control', 'no-store')
    const product = catalog.detail(sku)
    if (!product) throw notFound()
    return product
  })

export const requireEditor = createServerFn({ method: 'GET' }).handler(() => {
  if (!isEditor(getRequest().headers.get('cookie'))) throw redirect({ to: '/login' })
  setResponseHeader('Cache-Control', 'no-store')
  return catalog.list()
})
