import { Link, data, redirect } from "react-router";
import type { Route } from "./+types/product";
import { catalog, privateHeaders, productName, requireEditor } from "../catalog.server";
import { isEditor } from "../../../../fixture/domain.mjs";

export function loader({ request, params }: Route.LoaderArgs) {
  const product = catalog.detail(params.sku);
  if (!product) throw new Response("Unknown product", { status: 404, headers: privateHeaders });
  return data({ product, editor: isEditor(request.headers.get("cookie")) }, {
    headers: privateHeaders,
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  requireEditor(request);
  if (!catalog.detail(params.sku)) {
    throw new Response("Unknown product", { status: 404, headers: privateHeaders });
  }
  const name = await productName(request);
  catalog.update(params.sku, name);
  return redirect(`/products/${params.sku}`, { status: 303, headers: privateHeaders });
}

export default function Product({ loaderData }: Route.ComponentProps) {
  const { product, editor } = loaderData;
  return (
    <section>
      <Link to="/">← All products</Link>
      <h1>{product.name}</h1>
      <p className="lede">SKU: {product.sku}</p>
      {editor && (
        <section className="card">
          <h2>Edit product</h2>
          <form method="post" action={`/products/${product.sku}`} className="form">
            <label>Product name <input name="name" defaultValue={product.name} minLength={3} required /></label>
            <button type="submit">Save changes</button>
          </form>
          <form action={`/products/${product.sku}/delete`} method="post">
            <button type="submit">Delete product</button>
          </form>
        </section>
      )}
    </section>
  );
}
