import { Form, Link, data } from "react-router";
import type { Route } from "./+types/admin";
import { catalog, privateHeaders, requireEditor } from "../catalog.server";

export function loader({ request }: Route.LoaderArgs) {
  requireEditor(request);
  return data({ products: catalog.list() }, { headers: privateHeaders });
}

export default function Admin({ loaderData }: Route.ComponentProps) {
  const { products } = loaderData;
  return <main><nav><Link to="/products">Catalog</Link></nav><h1>Manage products</h1>
    <ul>{products.map((product) => <li key={product.sku}><Link to={`/products/${product.sku}`}>{product.name}</Link></li>)}</ul>
    <Form method="post" action="/products" reloadDocument><label>Name <input name="name" minLength={3} required /></label><button type="submit">Create</button></Form>
    <Form method="post" action="/logout" reloadDocument><button type="submit">Log out</button></Form>
  </main>;
}
