import {
  defineNextApplication,
  type NextAdapterLoader,
  type NextAdapterOptions,
  NextHttpApplicationAdapter,
} from '@fluojs/platform-nextjs';
import {
  createNextAppRouterHandler,
  type NextAppRouteHandler,
  type NextAppRouterMethodHandlers,
} from '@fluojs/platform-nextjs/app-router';
import {
  createNextPagesRouterHandler,
  type NextPagesRouterConfig,
} from '@fluojs/platform-nextjs/pages-router';

// Next build typechecks this consumer against staged distribution declarations.
// It is not a route and is never executed during build or server bootstrap.
export function publicApiTypes() {
  const options = { headRouting: 'explicit-or-get', maxBodySize: 128 } satisfies NextAdapterOptions;
  const adapter = NextHttpApplicationAdapter.create(options);
  const load: NextAdapterLoader = async () => adapter;
  const get = defineNextApplication({ key: 'public-types-only', load });
  const methods: NextAppRouterMethodHandlers = createNextAppRouterHandler(get);
  const head: NextAppRouteHandler = methods.HEAD;
  const pages = createNextPagesRouterHandler(get);
  const config = { api: { bodyParser: false } } satisfies NextPagesRouterConfig;
  return { adapter, methods, head, pages, config };
}
