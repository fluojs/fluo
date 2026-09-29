import {
  createCatalog,
  isEditor,
  SESSION_COOKIE,
  SESSION_VALUE,
  validateProduct,
} from "../../../fixture/domain.mjs";

export const catalog = createCatalog();
export const devCatalogTitle = "Product catalog";

export const privateHeaders = { "Cache-Control": "no-store" } as const;

export function requireEditor(request: Request): void {
  if (!isEditor(request.headers.get("cookie"))) {
    throw new Response("Editor access required", { status: 403, headers: privateHeaders });
  }
}

export async function productName(request: Request): Promise<string> {
  const form = await request.formData();
  const result = validateProduct(form.get("name"));
  if (!result.ok) {
    throw new Response("Product name must contain at least three characters", {
      status: 400,
      headers: privateHeaders,
    });
  }
  return result.name;
}

export const sessionCookie =
  `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax`;
