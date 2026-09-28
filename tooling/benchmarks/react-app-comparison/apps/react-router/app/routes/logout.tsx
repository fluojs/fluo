import { redirect } from "react-router";
import { SESSION_COOKIE } from "../../../../fixture/domain.mjs";
import { privateHeaders } from "../catalog.server";

export function action() {
  return redirect("/products", {
    status: 303,
    headers: {
      ...privateHeaders,
      "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
}

export function loader() {
  return redirect("/");
}
