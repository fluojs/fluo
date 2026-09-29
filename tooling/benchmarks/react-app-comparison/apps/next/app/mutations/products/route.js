import { catalog } from '../../../lib/catalog';
import { authorized, postRedirect, productName, rejected } from '../../../lib/responses';

export async function POST(request) {
  if (!authorized(request)) return rejected(403, 'Editor access required');
  const name = productName(await request.formData());
  if (!name.ok) return rejected(400, name.code);
  const product = catalog.create(name.name);
  return postRedirect(`/products/${product.sku}`);
}
