import { catalog } from '../../../../lib/catalog';
import { authorized, postRedirect, productName, rejected } from '../../../../lib/responses';

export async function POST(request, { params }) {
  if (!authorized(request)) return rejected(403, 'Editor access required');
  const name = productName(await request.formData());
  if (!name.ok) return rejected(400, name.code);
  const { sku } = await params;
  if (!catalog.update(sku, name.name)) return rejected(404, 'Product not found');
  return postRedirect(`/products/${sku}`);
}
