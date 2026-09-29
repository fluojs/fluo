import { catalog } from '../../../../../lib/catalog';
import { authorized, postRedirect, rejected } from '../../../../../lib/responses';

export async function POST(
  request,
  { params },
) {
  if (!authorized(request)) return rejected(403, 'Editor access required');
  const { sku } = await params;
  if (!catalog.delete(sku)) return rejected(404, 'Product not found');
  return postRedirect('/');
}
