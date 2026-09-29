import { redirect } from "react-router";
import type { Route } from "./+types/login";
import { authenticate } from "../../../../fixture/domain.mjs";
import { privateHeaders, sessionCookie } from "../catalog.server";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  if (!authenticate(form.get("username"), form.get("password"))) {
    return new Response("Invalid credentials", { status: 401, headers: privateHeaders });
  }
  return redirect("/admin/products", {
    status: 303,
    headers: { ...privateHeaders, "Set-Cookie": sessionCookie },
  });
}

export default function Login() {
  return (
    <section>
      <h1>Editor login</h1>
      <p className="lede">Sign in to create, update, and remove products.</p>
      <form method="post" action="/login" className="form card">
        <label>Username <input name="username" autoComplete="username" required /></label>
        <label>Password <input name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit">Log in</button>
      </form>
    </section>
  );
}
