import { redirect } from "react-router";
import type { Route } from "./+types/delete-product";
import { catalog, privateHeaders, requireEditor } from "../catalog.server";

export function action({ request, params }: Route.ActionArgs) {
  requireEditor(request);
  if (!catalog.delete(params.sku)) {
    throw new Response("Unknown product", { status: 404, headers: privateHeaders });
  }
  return redirect("/", { status: 303, headers: privateHeaders });
}

export function loader() {
  return redirect("/");
}
