import { Link, data } from "react-router";
import type { Route } from "./+types/home";
import { catalog, devCatalogTitle, privateHeaders } from "../catalog.server";

export function loader() {
  return data({ products: catalog.list(), title: devCatalogTitle }, { headers: privateHeaders });
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <section>
      <p className="lede">One shared catalog, three songs, and real server-rendered routes.</p>
      <h1>{loaderData.title}</h1>
      <ul className="list">
        {loaderData.products.map((product) => (
          <li className="card" key={product.sku}>
            <Link to={`/products/${product.sku}`}>{product.name}</Link>
            <p>{product.sku}</p>
          </li>
        ))}
      </ul>
      <section className="card">
        <h2>Create a product</h2>
        <form action="/products" method="post" className="form">
          <label>Product name <input name="name" minLength={3} required /></label>
          <button type="submit">Create product</button>
        </form>
      </section>
    </section>
  );
}
