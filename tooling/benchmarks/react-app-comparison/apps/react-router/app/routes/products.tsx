import Home, { loader as homeLoader } from "./home";
import { redirect } from "react-router";
import type { Route } from "./+types/products";
import { catalog, privateHeaders, productName, requireEditor } from "../catalog.server";

export async function action({ request }: Route.ActionArgs) {
  requireEditor(request);
  const name = await productName(request);
  const product = catalog.create(name);
  return redirect(`/products/${product.sku}`, { status: 303, headers: privateHeaders });
}

export function loader() {
  return homeLoader();
}

export default Home;
