import { createCatalog } from '../../../fixture/domain.mjs'

// Shared for the lifetime of one production server process.
export const catalog = createCatalog()
export const devCatalogTitle = 'Products'
