import { FromBody, FromPath, FromQuery, Post, RequestDto, UseGuards, UseInterceptors, ForbiddenException, Optional,
  UnauthorizedException, NotFoundException, type GuardContext, type InterceptorContext, type CallHandler,
  type HttpErrorRepresentationOptions, type RequestContext } from '@fluojs/http';
import type { MiddlewareContext, Next } from '@fluojs/http';
import { PageMetadata, Path, Router, ReactModule } from '@fluojs/react';
import { IsIn, IsString, Matches, MinLength } from '@fluojs/validation';
import type { CatalogPageProps } from './catalog-page';

export type CatalogObservation = {
  readonly phase: 'middleware' | 'guard' | 'interceptor' | 'dto' | 'handler' | 'commit' | 'cleanup';
  readonly scope: string;
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly matched: string;
  readonly name?: string;
  readonly intent?: string | undefined;
  readonly tag?: readonly string[] | undefined;
  readonly dto?: boolean;
};
export type CatalogControl = (event: CatalogObservation, context: RequestContext) => void | Promise<void>;

class CatalogWrite {
  @Optional()
  @FromBody('tag')
  tag?: string[];
  @FromBody('csrf')
  csrf = '';
  @Optional()
  @FromBody('intent')
  intent?: string;
  @FromBody('display_name')
  @IsString()
  @MinLength(3)
  name = '';
}
class CatalogNavigationSearch {
  @FromQuery('q')
  @IsString()
  query = '';
}
class CatalogUpdate {
  @Optional()
  @FromBody('tag')
  tag?: string[];
  @FromBody('csrf')
  csrf = '';
  @Optional()
  @FromBody('intent')
  intent?: string;
  @FromBody('display_name')
  @IsString()
  @MinLength(3)
  name = '';
  @FromPath('sku')
  sku = '';
}
class CatalogDelete {
  @FromBody('csrf')
  csrf = '';
  @Optional()
  @FromBody('intent')
  intent?: string;
  @FromPath('sku')
  sku = '';
}

class SessionLogin {
  @FromBody('csrf')
  csrf = '';
  @FromBody('identity')
  @IsIn(['a', 'b'])
  identity = '';
}
class CatalogSearch {
  @Optional()
  @FromQuery('q')
  @IsString()
  q?: string;
}
class CatalogDetail {
  @FromPath('sku')
  @IsString()
  @Matches(/\S/)
  sku = '';
}
class QueueWrite {
  @FromBody('csrf')
  csrf = '';
  @FromBody('intent')
  @IsIn(['add', 'remove'])
  intent = '';
  @FromPath('sku')
  sku = '';
}

export function createCatalogRouter<Result>(
  render: (props: CatalogPageProps, context: RequestContext) => Result,
  control?: CatalogControl,
) {
  const products = new Map([['sku-42', 'Seeded product']]);
  const songs = new Map([['blue', 'Blue song'], ['green', 'Green song'], ['gold', 'Gold song']]);
  const queue = new Set<string>();
  let queueRevision = 0;
  let sequence = 0;
  const sessionProducts = new Map<string, string>([['sku-42', 'Seeded product']]);
  let sessionSequence = 0;
  const matchedKey = Symbol('catalog.matched-handler');
  const event = (context: RequestContext, phase: CatalogObservation['phase'], scope: string,
    extra: Pick<CatalogObservation, 'name' | 'intent' | 'tag' | 'dto'> = {}): CatalogObservation => ({
    phase, scope, requestId: context.requestId ?? scope, method: context.request.method,
    path: context.request.path, matched: typeof context.metadata[matchedKey] === 'string'
      ? String(context.metadata[matchedKey]) : '', ...extra,
  });
  class CatalogProbe {
    readonly id = crypto.randomUUID();
    context?: RequestContext;
    async onDestroy(): Promise<void> {
      if (this.context !== undefined) await control?.(event(this.context, 'cleanup', this.id), this.context);
    }
  }
  const observe = async (context: RequestContext, phase: CatalogObservation['phase'],
    extra: Pick<CatalogObservation, 'name' | 'intent' | 'tag' | 'dto'> = {}): Promise<string> => {
    const probe = await context.container.resolve(CatalogProbe);
    probe.context = context;
    await control?.(event(context, phase, probe.id, extra), context);
    return probe.id;
  };
  class CatalogMiddleware {
    async handle({ requestContext }: MiddlewareContext, next: Next): Promise<void> {
      const id = await observe(requestContext, 'middleware');
      requestContext.response.setHeader('X-Catalog-Scope', id);
      await next();
    }
  }
  class CatalogGuard {
    async canActivate({ requestContext, handler }: GuardContext): Promise<boolean> {
      requestContext.metadata[matchedKey] = handler.methodName;
      await observe(requestContext, 'guard');
      const { request } = requestContext;
      if (request.cookies.editor !== 'yes') throw new UnauthorizedException('An editor session is required.');
      const host = request.headers.host;
      if (typeof host !== 'string' || request.headers.origin !== `http://${host}`) throw new ForbiddenException('Origin rejected.');
      const body = request.body;
      if (typeof body !== 'object' || body === null || Reflect.get(body, 'csrf') !== request.cookies.csrf
        || request.cookies.csrf !== 'catalog-demo-token') throw new ForbiddenException('CSRF rejected.');
      return true;
    }
  }
  class SessionWriteGuard {
    async canActivate({ requestContext, handler }: GuardContext): Promise<boolean> {
      requestContext.metadata[matchedKey] = handler.methodName;
      await observe(requestContext, 'guard');
      const { request } = requestContext;
      const body: unknown = request.body;
      if (request.headers.origin !== `http://${request.headers.host}`
        || request.cookies.csrf !== 'catalog-demo-token'
        || typeof body !== 'object' || body === null
        || Reflect.get(body, 'csrf') !== request.cookies.csrf) throw new ForbiddenException('Session origin/CSRF rejected.');
      return true;
    }
  }
  class ProductSessionGuard {
    async canActivate({ requestContext, handler }: GuardContext): Promise<boolean> {
      requestContext.metadata[matchedKey] = handler.methodName;
      await observe(requestContext, 'guard');
      const identity = requestContext.request.cookies.catalogSession;
      if (identity !== 'a' && identity !== 'b') throw new UnauthorizedException('Session expired.');
      if (requestContext.request.cookies.catalogAccess === 'forbidden') throw new ForbiddenException('Permission denied.');
      return true;
    }
  }
  class CatalogInterceptor {
    readonly id = crypto.randomUUID();
    async intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
      context.requestContext.metadata[matchedKey] = context.handler.methodName;
      await observe(context.requestContext, 'interceptor');
      context.requestContext.response.setHeader('X-Catalog-Interceptor', 'approved');
      context.requestContext.response.setHeader('X-Catalog-Request-Scope', this.id);
      return next.handle();
    }
  }
  const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  @Router('/catalog')
  class CatalogRouter {
    @PageMetadata(() => ({ title: 'Authenticated product catalog' }))
    @Path('/session/products')
    @RequestDto(CatalogSearch)
    @UseGuards(ProductSessionGuard)
    @UseInterceptors(CatalogInterceptor)
    async authenticatedList(input: CatalogSearch, context: RequestContext) {
      await observe(context, 'dto', { name: input.q ?? '', dto: input instanceof CatalogSearch });
      await observe(context, 'handler');
      return render({ products: Array.from(sessionProducts, ([sku, name]) => ({ sku, name }))
        .filter((product) => product.name.toLowerCase().includes((input.q ?? '').toLowerCase())),
        authenticatedCrud: true,
        ...(context.request.cookies.catalogSession === undefined ? {} : { sessionIdentity: context.request.cookies.catalogSession }),
        ...(input.q ? { searchQuery: input.q } : {}) }, context);
    }
    @PageMetadata(({ request }) => ({ title: `Private product ${request.params.sku ?? ''}` }))
    @Path('/session/products/:sku')
    @RequestDto(CatalogDetail)
    @UseGuards(ProductSessionGuard)
    @UseInterceptors(CatalogInterceptor)
    async authenticatedDetail(input: CatalogDetail, context: RequestContext) {
      await observe(context, 'dto', { dto: input instanceof CatalogDetail });
      await observe(context, 'handler');
      const sku = input.sku;
      const name = sessionProducts.get(sku);
      if (name === undefined) throw new NotFoundException('Product not found.');
      return render({ products: [{ sku, name }], selected: sku, authenticatedCrud: true,
        ...(context.request.cookies.catalogSession === undefined ? {} : { sessionIdentity: context.request.cookies.catalogSession }) }, context);
    }
    @Post('/session/products/create')
    @RequestDto(CatalogWrite)
    @UseGuards(ProductSessionGuard, SessionWriteGuard)
    @UseInterceptors(CatalogInterceptor)
    async authenticatedCreate(input: CatalogWrite, context: RequestContext) {
      const extra = { name: input.name, intent: input.intent, dto: input instanceof CatalogWrite };
      const scope = await observe(context, 'dto', extra);
      await observe(context, 'handler', extra);
      const sku = `item-${++sessionSequence}`;
      sessionProducts.set(sku, input.name);
      await control?.(event(context, 'commit', scope, extra), context);
      return ReactModule.formResult({ destination: `/catalog/session/products/${sku}`, followUp: 'navigate',
        data: { sku, name: input.name } });
    }
    @Post('/session/products/:sku/update')
    @RequestDto(CatalogUpdate)
    @UseGuards(ProductSessionGuard, SessionWriteGuard)
    @UseInterceptors(CatalogInterceptor)
    async authenticatedUpdate(input: CatalogUpdate, context: RequestContext) {
      const extra = { name: input.name, intent: input.intent, dto: input instanceof CatalogUpdate };
      const scope = await observe(context, 'dto', extra);
      await observe(context, 'handler', extra);
      if (!sessionProducts.has(input.sku)) throw new NotFoundException('Product not found.');
      sessionProducts.set(input.sku, input.name);
      await control?.(event(context, 'commit', scope, extra), context);
      return ReactModule.formResult({ destination: `/catalog/session/products/${input.sku}`, followUp: 'refresh',
        data: { sku: input.sku, name: input.name } });
    }
    @Post('/session/products/:sku/delete')
    @RequestDto(CatalogDelete)
    @UseGuards(ProductSessionGuard, SessionWriteGuard)
    @UseInterceptors(CatalogInterceptor)
    async authenticatedDelete(input: CatalogDelete, context: RequestContext) {
      const extra = { intent: input.intent, dto: input instanceof CatalogDelete };
      const scope = await observe(context, 'dto', extra);
      await observe(context, 'handler', extra);
      if (!sessionProducts.delete(input.sku)) throw new NotFoundException('Product not found.');
      await control?.(event(context, 'commit', scope, extra), context);
      return ReactModule.formResult({ destination: '/catalog/session/products', followUp: 'navigate',
        data: { sku: input.sku } });
    }
    @PageMetadata(() => ({ title: 'Background catalog and jukebox' }))
    @Path('/background')
    @RequestDto(CatalogSearch)
    async background(input: CatalogSearch, context: RequestContext) {
      await observe(context, 'handler', { name: input.q ?? '' });
      return render({ products: Array.from(songs, ([sku, name]) => ({ sku, name })),
        backgroundDemo: true, queued: [...queue], searchQuery: input.q ?? '', revision: queueRevision }, context);
    }
    @Path('/background/search')
    @RequestDto(CatalogSearch)
    @UseInterceptors(CatalogInterceptor)
    async backgroundSearch(input: CatalogSearch, context: RequestContext) {
      await observe(context, 'dto', { name: input.q ?? '', dto: input instanceof CatalogSearch });
      await observe(context, 'handler', { name: input.q ?? '' });
      const rows = Array.from(songs, ([sku, name]) => ({ sku, name }))
        .filter((song) => song.name.toLowerCase().includes((input.q ?? '').toLowerCase()));
      if (context.request.headers.accept === 'application/json') return { rows, query: input.q ?? '' };
      return render({ products: rows, backgroundDemo: true, queued: [...queue],
        searchQuery: input.q ?? '', revision: queueRevision }, context);
    }
    @Post('/background/queue/:sku')
    @RequestDto(QueueWrite)
    @UseGuards(CatalogGuard)
    @UseInterceptors(CatalogInterceptor)
    async queueWrite(input: QueueWrite, context: RequestContext) {
      const extra = { name: input.sku, intent: input.intent, dto: input instanceof QueueWrite };
      const scope = await observe(context, 'dto', extra);
      await observe(context, 'handler', extra);
      if (!songs.has(input.sku)) throw new NotFoundException('Song not found.');
      if (input.intent === 'add') queue.add(input.sku);
      else queue.delete(input.sku);
      const revision = ++queueRevision;
      await control?.(event(context, 'commit', scope, extra), context);
      return ReactModule.formResult({ destination: '/catalog/background', followUp: 'refresh',
        data: { sku: input.sku, queued: input.intent === 'add', revision } });
    }
    @Path('/session')
    sessionEntry(_input: undefined, context: RequestContext) {
      context.response.setHeader('Set-Cookie', 'csrf=catalog-demo-token; Path=/; SameSite=Lax');
      return render({ products: [], sessionDemo: true }, context);
    }
    @PageMetadata(({ request }) => ({
      title: `Protected ${request.cookies.catalogSession ?? ''}`,
      links: [{ rel: 'canonical', href: request.url }],
    }))
    @Path('/session/protected')
    async sessionPage(_input: undefined, context: RequestContext) {
      const identity = context.request.cookies.catalogSession;
      await observe(context, 'handler');
      if (identity !== 'a' && identity !== 'b') throw new UnauthorizedException('Session expired.');
      if (context.request.cookies.catalogAccess === 'forbidden') throw new ForbiddenException('Permission denied.');
      return render({ products: [{ sku: `private-${identity}`, name: `Protected content ${identity}` }],
        sessionDemo: true, sessionIdentity: identity }, context);
    }
    @Post('/session/login')
    @RequestDto(SessionLogin)
    @UseGuards(SessionWriteGuard)
    @UseInterceptors(CatalogInterceptor)
    async sessionLogin(input: SessionLogin, context: RequestContext) {
      const scope = await observe(context, 'handler');
      context.response.setHeader('Set-Cookie', [
        `catalogSession=${input.identity}; Path=/; HttpOnly; SameSite=Lax`,
        'catalogAccess=allowed; Path=/; HttpOnly; SameSite=Lax',
      ]);
      await control?.(event(context, 'commit', scope), context);
      return ReactModule.formResult({ destination: '/catalog/session/protected', followUp: 'navigate',
        session: { epoch: `demo:${input.identity}`, reason: 'login' } });
    }
    @Post('/session/logout')
    @UseGuards(SessionWriteGuard)
    @UseInterceptors(CatalogInterceptor)
    async sessionLogout(_input: undefined, context: RequestContext) {
      const scope = await observe(context, 'handler');
      context.response.setHeader('Set-Cookie', 'catalogSession=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax');
      await control?.(event(context, 'commit', scope), context);
      return ReactModule.formResult({ destination: '/catalog/session', followUp: 'navigate',
        session: { epoch: 'demo:signed-out', reason: 'logout' } });
    }
    @Post('/session/permissions')
    @UseGuards(SessionWriteGuard)
    @UseInterceptors(CatalogInterceptor)
    async sessionPermissions(_input: undefined, context: RequestContext) {
      const scope = await observe(context, 'handler');
      if (context.request.cookies.catalogSession === undefined) throw new UnauthorizedException('Session expired.');
      context.response.setHeader('Set-Cookie', 'catalogAccess=forbidden; Path=/; HttpOnly; SameSite=Lax');
      await control?.(event(context, 'commit', scope), context);
      return ReactModule.formResult({ destination: '/catalog/session/protected', followUp: 'refresh',
        session: { epoch: `demo:${context.request.cookies.catalogSession}`, reason: 'permissions' } });
    }
    @Path('/login')
    login(_input: undefined, context: RequestContext): void {
      context.response.setHeader('Set-Cookie', [
        'editor=yes; Path=/; HttpOnly; SameSite=Lax',
        'csrf=catalog-demo-token; Path=/; SameSite=Lax',
      ]);
      context.response.redirect(303, '/catalog');
    }
    @Path('/')
    list(_input: undefined, context: RequestContext) {
      return render({ products: Array.from(products, ([sku, name]) => ({ sku, name })) }, context);
    }
    @Path('/search')
    @RequestDto(CatalogNavigationSearch)
    search(input: CatalogNavigationSearch, context: RequestContext) {
      return render({ products: Array.from(products, ([sku, name]) => ({ sku, name }))
        .filter((product) => product.name.toLowerCase().includes(input.query.toLowerCase())),
        searchQuery: input.query }, context);
    }
    @PageMetadata(({ request }) => ({
      title: `Catalog: ${products.get(request.params.sku ?? '') ?? 'Product'}`,
      links: [{ rel: 'canonical', href: request.url }],
    }))
    @Path('/:sku')
    detail(_input: undefined, context: RequestContext) {
      const sku = context.request.params.sku ?? '';
      const name = products.get(sku);
      if (name === undefined) throw new NotFoundException('Product not found.');
      return render({ products: [{ sku, name }], selected: sku }, context);
    }
    @Post('/create')
    @RequestDto(CatalogWrite)
    @UseGuards(CatalogGuard)
    @UseInterceptors(CatalogInterceptor)
    async create(input: CatalogWrite, context: RequestContext) {
      const extra = { name: input.name, intent: input.intent, tag: input.tag, dto: input instanceof CatalogWrite };
      const scope = await observe(context, 'dto', extra);
      await observe(context, 'handler', extra);
      const sku = `item-${++sequence}`;
      products.set(sku, input.name);
      await control?.(event(context, 'commit', scope, extra), context);
      return ReactModule.formResult({ destination: `/catalog/${sku}`, followUp: 'navigate' });
    }
    @Post('/:sku/update')
    @RequestDto(CatalogUpdate)
    @UseGuards(CatalogGuard)
    @UseInterceptors(CatalogInterceptor)
    async update(input: CatalogUpdate, context: RequestContext) {
      const extra = { name: input.name, intent: input.intent, tag: input.tag, dto: input instanceof CatalogUpdate };
      const scope = await observe(context, 'dto', extra);
      await observe(context, 'handler', extra);
      if (!products.has(input.sku)) throw new NotFoundException('Product not found.');
      products.set(input.sku, input.name);
      await control?.(event(context, 'commit', scope, extra), context);
      return ReactModule.formResult({ destination: `/catalog/${input.sku}`, followUp: 'refresh' });
    }
    @Post('/:sku/delete')
    @RequestDto(CatalogDelete)
    @UseGuards(CatalogGuard)
    @UseInterceptors(CatalogInterceptor)
    async delete(input: CatalogDelete, context: RequestContext) {
      const scope = await observe(context, 'dto', { intent: input.intent, dto: input instanceof CatalogDelete });
      await observe(context, 'handler', { intent: input.intent });
      products.delete(input.sku);
      await control?.(event(context, 'commit', scope, { intent: input.intent }), context);
      return ReactModule.formResult({ destination: '/catalog', followUp: 'navigate' });
    }
  }
  const errorRepresentation: HttpErrorRepresentationOptions = {
    form: { project: () => ({ fieldErrors: { name: ['Use at least three characters.'] }, formErrors: [] }) },
    html: {
      canRender: ({ handler }) => handler?.controllerToken === CatalogRouter,
      render: ({ validationOrigin, request, error }) => {
        const authenticated = request.path.startsWith('/catalog/session/products');
        const name: unknown = typeof request.body === 'object' && request.body !== null
          ? Reflect.get(request.body, 'display_name') : undefined;
        const value = typeof name === 'string' ? escape(name.slice(0, 256)) : '';
        // Only the authored display name is retained; tokens and exceptions are not reflected.
        return '<!doctype html><html lang="en"><head><title>Catalog submission</title></head><body><main>'
          + (validationOrigin === undefined
            ? `<h1>Submission refused (${error.status})</h1><a href="${authenticated ? '/catalog/session' : '/catalog/login'}">${authenticated ? 'Sign in to demo session' : 'Sign in as demo editor'}</a>`
            : `<h1>Correct product input</h1><form method="post" action="${escape(request.path)}" enctype="application/x-www-form-urlencoded">`
              + `<label for="correct-name">Product name</label><input id="correct-name" name="display_name" value="${value}" minlength="3" required aria-invalid="true" aria-describedby="name-errors">`
              + '<p id="name-errors">Use at least three characters.</p><input type="hidden" name="csrf" value="catalog-demo-token"><button>Save product</button></form>')
          + `<a href="${authenticated ? '/catalog/session/products' : '/catalog'}">Catalog</a></main></body></html>`;
      },
    },
  };
  return { router: CatalogRouter, middleware: [CatalogMiddleware], providers: [
    CatalogGuard, CatalogMiddleware, SessionWriteGuard, ProductSessionGuard,
    { provide: CatalogProbe, useClass: CatalogProbe, scope: 'request' as const },
    { provide: CatalogInterceptor, useClass: CatalogInterceptor, scope: 'request' as const },
  ], errorRepresentation };
}
