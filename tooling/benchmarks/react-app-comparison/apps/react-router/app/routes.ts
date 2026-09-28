import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("./routes/home.tsx"),
  route("login", "./routes/login.tsx"),
  route("logout", "./routes/logout.tsx"),
  route("products", "./routes/products.tsx"),
  route("products/:sku", "./routes/product.tsx"),
  route("products/:sku/delete", "./routes/delete-product.tsx"),
  route("admin/products", "./routes/admin.tsx"),
  route("jukebox", "./routes/jukebox.tsx", [
    route(":view", "./routes/jukebox-view.tsx"),
  ]),
] satisfies RouteConfig;
